const fs = require('fs');
const express = require('express');
const { google } = require('googleapis');
const cookieParser = require('cookie-parser');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { updateUserLastLogin, getUserLastLogin, updateCheckedEmail, getCheckedEmails, storeTask, clearCompletedTasks, getTasks } = require('./database');

require('dotenv').config();

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];
const CREDENTIALS_PATH = 'credentials.json';
const TOKEN_PATH = 'token.json';

const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const { client_secret, client_id, redirect_uris } = credentials.web;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  "http://localhost:3000/api/auth/callback/"
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

if (fs.existsSync(TOKEN_PATH)) {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oAuth2Client.setCredentials(token);
}

app.get('/', (req, res) => {
  if (oAuth2Client.credentials && oAuth2Client.credentials.access_token) {
    res.redirect('/dashboard');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

app.get('/login', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  res.redirect(authUrl);
});

app.get('/api/auth/callback/', async (req, res) => {
  const code = req.query.code;
  if (code) {
    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({
        auth: oAuth2Client,
        version: 'v2'
      });

      const userInfo = await oauth2.userinfo.get();
      const email = userInfo.data.email;

      res.cookie('token', JSON.stringify(tokens), { httpOnly: true });
      res.cookie('email', email, { httpOnly: true });

      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));

      res.redirect('/dashboard');
    } catch (error) {
      console.error('Error retrieving access token or user info:', error);
      res.redirect('/');
    }
  } else {
    res.redirect('/');
  }
});

async function analyzeEmailContent(subject, body, sentDate) {
  try {
    const prompt = `
      Analyze the following email for any mentions of tasks or to-dos for the recipient. 
      If there are no tasks with deadlines, respond with only the word "No". 
      If there are tasks with deadlines, list each task in the format: 
      "YYYY-MM-DD HH:mm:ss | Give a short, 1-sentence description of the task, as described in the email"

      Always use the format YYYY-MM-DD HH:mm:ss for the date, even if the year is not explicitly mentioned (assume current year in that case). If time is not mentioned, assume 23:59:00. Respond in 24-hour time. Punctuation within the sentence is ok, but do not end the sentence with a period.
      If you can detect that a task is present, but cannot detect what the deadline should be (for example, if the deadline is stated as "next time we meet"), or if there is no deadline present at all, instead of YYYY-MM-DD HH:mm:ss, just say "Unknown | *task description*
      Your tasks should be written in a way that is helpful to have on a to-do list. For example, if the email says, "I'd love it if you completed worksheet 5.2 by Tuesday!", the task should be something like, "Finish Worksheet 5.2". 
      For emails that are replies to other emails, answer *only the most recent email body*. Do not re-analyze the previous emails in the thread. For tasks that say they are due "in the afternoon", set the deadline to 5:00pm.

      Each email may have more than one task, each with varying deadlines. Respond with each task in a newline-separated format. You should be able to find dates for holidays or events, like Halloween, Christmas, the New Year, etc.

      In all cases, respond with ONLY either "No" or the correctly formatted String ("YYYY-MM-DD HH:mm:ss | Give a short, 1-sentence description of the task, as described in the email"). Never include other explanations, prefaces, filler words, or anything else.

      Calculate relative dates based on the email sent date: ${sentDate}.

      Email Subject: ${subject}
      Email Body: ${body}
    `;

    console.log('Sending prompt to Anthropic:', prompt);

    const response = await anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 300,
      messages: [
        { role: "user", content: prompt }
      ]
    });

    console.log('Received response from Anthropic:', response.content[0].text);

    return response.content[0].text.trim();
  } catch (error) {
    console.error('Error in analyzeEmailContent:', error);
    throw error;
  }
}

async function fetchAndAnalyzeEmails(oAuth2Client, email, lastLogin) {
  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  let query = lastLogin ? `after:${Math.floor(new Date(lastLogin).getTime() / 1000)}` : '';

  console.log('Fetching emails with query:', query);

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: lastLogin ? 100 : 30,
      q: query,
    });

    console.log('Fetched messages:', response.data.messages ? response.data.messages.length : 0);

    if (response.data.messages) {
      const emails = await Promise.all(
        response.data.messages.map(async (message) => {
          const msg = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
          });
          const headers = msg.data.payload.headers;
          const subjectHeader = headers.find(header => header.name === 'Subject');
          const subject = subjectHeader ? subjectHeader.value : 'No Subject';
          const body = msg.data.snippet;
          const sentDate = new Date(parseInt(msg.data.internalDate));
          
          console.log('Analyzing email:', subject);
          const analysis = await analyzeEmailContent(subject, body, sentDate);
          console.log('Analysis result:', analysis);
          
          return { id: message.id, subject, analysis, sentDate };
        })
      );

      for (const email of emails) {
        if (email.analysis !== 'No') {
          console.log('Storing task:', email.subject);
          await new Promise((resolve, reject) => {
            storeTask(email.id, email.subject, email.analysis, email.sentDate, (err) => {
              if (err) {
                console.error('Error storing task:', err);
                reject(err);
              } else {
                resolve();
              }
            });
          });
        }
      }

      return emails;
    }
  } catch (error) {
    console.error('Error in fetchAndAnalyzeEmails:', error);
    throw error;
  }

  return [];
}

async function getUserProfile(auth) {
  const oauth2Client = google.oauth2({ version: 'v2', auth });
  try {
    const userInfoResponse = await oauth2Client.userinfo.get();
    return userInfoResponse.data;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}

app.get('/dashboard', (req, res) => {
  const token = req.cookies.token ? JSON.parse(req.cookies.token) : null;
  if (!token) {
    return res.redirect('/login');
  }

  oAuth2Client.setCredentials(token);

  const email = req.cookies.email;
  if (!email) {
    return res.redirect('/login');
  }

  getUserLastLogin(email, async (err, lastLogin) => {
    if (err) {
      console.error('Error fetching last login:', err);
      return res.status(500).send('Error fetching last login.');
    }

    try {
      await fetchAndAnalyzeEmails(oAuth2Client, email, lastLogin);
      const userProfile = await getUserProfile(oAuth2Client);

      updateUserLastLogin(email, (err) => {
        if (err) {
          console.error('Error updating last login:', err);
        }
      });

      const lastLoginDisplay = lastLogin ? new Date(lastLogin).toLocaleString() : 'This is your first login';

      getTasks((err, tasks) => {
        if (err) {
          console.error('Error fetching tasks:', err);
          return res.status(500).send('Error fetching tasks.');
        }

        getCheckedEmails(email, (err, checkedEmailIds) => {
          if (err) {
            console.error('Error fetching checked emails:', err);
            return res.status(500).send('Error fetching checked emails.');
          }

          const currentTasks = tasks.filter(task => !checkedEmailIds.includes(task.id));
          const completedTasks = tasks.filter(task => checkedEmailIds.includes(task.id));

          console.log('Tasks to be rendered:', tasks);

          res.render('dashboard', {
            currentTasks: currentTasks,
            completedTasks: completedTasks,
            lastLoginDisplay: lastLoginDisplay,
            email: email,
            userName: userProfile ? userProfile.given_name || userProfile.name.split(' ')[0] : 'User'
          });
        });
      });
    } catch (error) {
      console.error('Error fetching email subjects:', error);
      res.status(500).send('Error fetching email subjects.');
    }
  });
});

app.post('/check-email', (req, res) => {
  const { email, emailId, checked } = req.body;
  updateCheckedEmail(email, emailId, checked, (err) => {
    if (err) {
      console.error('Error updating checked email:', err);
      res.status(500).send('Error updating checked email.');
    } else {
      res.sendStatus(200);
    }
  });
});

app.post('/logout', (req, res) => {
  oAuth2Client.setCredentials(null);
  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
  }
  res.clearCookie('token');
  res.clearCookie('email');
  res.redirect('/');
});

app.post('/clear-completed', (req, res) => {
    const email = req.body.email;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
  
    clearCompletedTasks(email, (err) => {
      if (err) {
        console.error('Error clearing completed tasks:', err);
        return res.status(500).json({ error: 'Error clearing completed tasks' });
      }
      
      // After successfully clearing tasks, fetch the updated task list
      getTasks((err, tasks) => {
        if (err) {
          console.error('Error fetching updated tasks:', err);
          return res.status(500).json({ error: 'Error fetching updated tasks' });
        }
        res.json({ success: true, tasks: tasks });
      });
    });
  });


app.listen(3000, () => {
  console.log('App running on http://localhost:3000');
});
