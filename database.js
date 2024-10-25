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
     CREATE TABLE IF NOT EXISTS stored_emails (
       id TEXT PRIMARY KEY,
       subject TEXT
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
     [email,lastLogin],
     callback
   );
}

function getUserLastLogin(email ,callback ) {

   db.get(
     `SELECT last_login FROM users WHERE email=?`,
     [email],
     (err,row )=>{

       if(err)return callback(err);
       callback(null,row?row.last_login:null);

     }
   );
}

function updateCheckedEmail(email,emailId ,checked ,callback ) {

   if(checked){
     db.run(
       `INSERT OR IGNORE INTO checked_emails(user_email,email_id )VALUES (?, ?)`,
       [email,emailId],
       callback
     );
   }else{
     db.run(
       `DELETE FROM checked_emails WHERE user_email=? AND email_id=?`,
       [email,emailId],
       callback
     );
   }
}

function getCheckedEmails(email ,callback ) {

   db.all(
     `SELECT email_id FROM checked_emails WHERE user_email=?`,
     [email],
     (err ,rows )=>{

       if(err)return callback(err);
       callback(null ,rows.map(row=>row.email_id));
     }
   );
}

function storeEmail(id ,subject ,callback ) {

   db.run(
     `INSERT OR REPLACE INTO stored_emails(id ,subject )VALUES (?, ?)`,
     [id ,subject],
     callback
   );
}

function getStoredEmails(callback ) {

   db.all(
     `SELECT id ,subject FROM stored_emails`,
     [],
     (err ,rows )=>{

       if(err)return callback(err);
       callback(null ,rows.map(row=>({id :row.id ,subject :row.subject})));
     }
   );
}

module.exports={
   updateUserLastLogin ,
   getUserLastLogin ,
   updateCheckedEmail ,
   getCheckedEmails ,
   storeEmail ,
   getStoredEmails
};
