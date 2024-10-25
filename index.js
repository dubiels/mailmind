const fs = require('fs');
const express = require('express');
const { google } = require('googleapis');
const cookieParser = require('cookie-parser');
const path = require('path');
const { updateUserLastLogin, getUserLastLogin, updateCheckedEmail, getCheckedEmails, storeEmail, getStoredEmails } = require('./database');

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
  'https://www.googleapis.com/auth/userinfo.profile' // Ensure this scope is included
];
const CREDENTIALS_PATH = 'credentials.json';
const TOKEN_PATH = 'token.json';

// Load client secrets from credentials.json
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const { client_secret, client_id, redirect_uris } = credentials.web;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  "http://localhost:3000/api/auth/callback/"
);

// Check if we have previously stored a token
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

async function fetchAndStoreEmails(oAuth2Client, email, lastLogin) {
  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  let query = lastLogin ? `after:${Math.floor(new Date(lastLogin).getTime() / 1000)}` : '';

  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults: lastLogin ? 100 : 10,
    q: query,
  });

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
        return { id: message.id, subject, body };
      })
    );

    const filteredEmails = emails.filter(email => email.body.toLowerCase().includes('please'));

    // Store new emails containing "please"
    for (const email of filteredEmails) {
      await new Promise((resolve, reject) => {
        storeEmail(email.id, email.subject, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    return filteredEmails;
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
      await fetchAndStoreEmails(oAuth2Client, email, lastLogin);
      const userProfile = await getUserProfile(oAuth2Client);

      updateUserLastLogin(email, (err) => {
        if (err) {
          console.error('Error updating last login:', err);
        }
      });

      const lastLoginDisplay = lastLogin ? new Date(lastLogin).toLocaleString() : 'This is your first login';

      // Fetch all stored emails and checked emails from the database
      getStoredEmails((err, storedEmails) => {
        if (err) {
          console.error('Error fetching stored emails:', err);
          return res.status(500).send('Error fetching stored emails.');
        }

        getCheckedEmails(email, (err, checkedEmailIds) => {
          if (err) {
            console.error('Error fetching checked emails:', err);
            return res.status(500).send('Error fetching checked emails.');
          }

          // Separate current and completed tasks
          const currentTasks = storedEmails.filter(email => !checkedEmailIds.includes(email.id));
          const completedTasks = storedEmails.filter(email => checkedEmailIds.includes(email.id));

          res.render('dashboard', {
            currentTasks: currentTasks,
            completedTasks: completedTasks,
            lastLoginDisplay: lastLoginDisplay,
            email: email,
            userName: userProfile ? userProfile.name : 'User' // Use user's name or default to "User"
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
    const email = req.cookies.email;
    
    if (!email) {
      return res.status(401).send('Unauthorized');
    }
  
    // Clear completed tasks from the database
    const query = `DELETE FROM checked_emails WHERE user_email = ?`;
    
    db.run(query, [email], function(err) {
      if (err) {
        console.error('Error clearing completed tasks:', err);
        return res.status(500).send('Error clearing completed tasks.');
      }
      res.sendStatus(200);
    });
  });

app.listen(3000, () => {
  console.log('App running on http://localhost:3000');
});


