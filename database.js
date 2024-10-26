const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./mailmind.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      last_login TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS checked_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT,
      email_id TEXT,
      UNIQUE(user_email, email_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      subject TEXT,
      description TEXT,
      due_date TEXT,
      email_date TEXT
    )
  `);
});

function updateUserLastLogin(email, callback) {
  const lastLogin = new Date().toISOString();
  db.run(
    `INSERT INTO users (email, last_login)
     VALUES (?, ?)
     ON CONFLICT(email) 
     DO UPDATE SET last_login=excluded.last_login`,
    [email, lastLogin],
    callback
  );
}

function getUserLastLogin(email, callback) {
  db.get(
    `SELECT last_login FROM users WHERE email = ?`,
    [email],
    (err, row) => {
      if (err) return callback(err);
      callback(null, row ? row.last_login : null);
    }
  );
}

function updateCheckedEmail(email, emailId, checked, callback) {
  if (checked) {
    db.run(
      `INSERT OR IGNORE INTO checked_emails (user_email, email_id) VALUES (?, ?)`,
      [email, emailId],
      callback
    );
  } else {
    db.run(
      `DELETE FROM checked_emails WHERE user_email = ? AND email_id = ?`,
      [email, emailId],
      callback
    );
  }
}

function getCheckedEmails(email, callback) {
  db.all(
    `SELECT email_id FROM checked_emails WHERE user_email = ?`,
    [email],
    (err, rows) => {
      if (err) {
        console.error('Error in getCheckedEmails:', err);
        return callback(err);
      }
      const checkedEmailIds = rows.map(row => row.email_id);
      console.log('Retrieved checked emails:', checkedEmailIds.length);
      callback(null, checkedEmailIds);
    }
  );
}

function storeTask(id, subject, analysis, emailDate, callback) {
  const [dueDate, description] = analysis.split(' | ');

  db.run(
    `INSERT OR REPLACE INTO tasks (id, subject, description, due_date, email_date) VALUES (?, ?, ?, ?, ?)`,
    [id, subject, description, dueDate, emailDate.toISOString()],
    function(err) {
      if (err) {
        console.error('Error in storeTask:', err);
      } else {
        console.log('Task stored successfully. Row ID:', this.lastID);
      }
      callback(err);
    }
  );
}

function getTasks(callback) {
  db.all(
    `SELECT * FROM tasks ORDER BY due_date ASC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Error in getTasks:', err);
        return callback(err);
      }
      console.log('Retrieved tasks:', rows.length);
      callback(null, rows);
    }
  );
}

function clearCompletedTasks(email, callback) {
  db.serialize(() => {
    // First, get all the checked email IDs for the user
    db.all(
      `SELECT email_id FROM checked_emails WHERE user_email = ?`,
      [email],
      (err, rows) => {
        if (err) {
          console.error('Error fetching checked emails:', err);
          return callback(err);
        }

        const checkedEmailIds = rows.map(row => row.email_id);

        // If there are no checked emails, we're done
        if (checkedEmailIds.length === 0) {
          return callback(null);
        }

        // Delete the tasks associated with these email IDs
        const placeholders = checkedEmailIds.map(() => '?').join(',');
        db.run(
          `DELETE FROM tasks WHERE id IN (${placeholders})`,
          checkedEmailIds,
          (err) => {
            if (err) {
              console.error('Error deleting tasks:', err);
              return callback(err);
            }

            // Now delete the entries from checked_emails
            db.run(
              `DELETE FROM checked_emails WHERE user_email = ?`,
              [email],
              (err) => {
                if (err) {
                  console.error('Error clearing checked emails:', err);
                  return callback(err);
                }
                console.log('Cleared completed tasks for user:', email);
                callback(null);
              }
            );
          }
        );
      }
    );
  });
}

module.exports = {
  updateUserLastLogin,
  getUserLastLogin,
  updateCheckedEmail,
  clearCompletedTasks,
  getCheckedEmails,
  storeTask,
  getTasks
};
