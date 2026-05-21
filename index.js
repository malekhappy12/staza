const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const dotenv = require('dotenv');
dotenv.config();
const webpush = require('web-push');
const vapidPublic = process.env.VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.VAPID_PRIVATE_KEY;


const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // <-- THIS is critical for reading JSON from req.body

app.use(
    session({
        secret: 'your_secret_key',
        resave: false,
        saveUninitialized: false
    })
);

// Database Connection
const db = mysql.createPool({
    host: 'localhost',
    user: 'malek',
    password: 'Mnml@1234',
    database: 'staza',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

console.log('VAPID_PUBLIC_KEY:', JSON.stringify(process.env.VAPID_PUBLIC_KEY));
console.log('VAPID_PRIVATE_KEY:', JSON.stringify(process.env.VAPID_PRIVATE_KEY));

if (!vapidPublic || !vapidPrivate) {
    console.error('❌ VAPID keys missing. Run: npx web-push generate-vapid-keys and add to .env');
    console.error('Current process.env.VAPID_PUBLIC_KEY:', !!process.env.VAPID_PUBLIC_KEY);
    process.exit(1);
  }

  webpush.setVapidDetails(
    'mailto:you@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );


// Return public VAPID key to the client
app.get('/vapid-public-key', requireLogin, (req, res) => {
    res.json({ key: process.env.VAPID_PUBLIC_KEY });
  });
  
  // Save/replace the user's push subscription
  app.post('/save-subscription', requireLogin, (req, res) => {
    const username = req.session.username;
    const sub = req.body; // {endpoint, keys:{p256dh, auth}}
  
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ message: 'Invalid subscription object' });
    }
  
    const q = `
      INSERT INTO push_subscriptions (username, endpoint, p256dh, auth)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE endpoint=VALUES(endpoint), p256dh=VALUES(p256dh), auth=VALUES(auth)
    `;
    db.query(q, [username, sub.endpoint, sub.keys.p256dh, sub.keys.auth], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ ok: true });
    });
  });
  
  async function sendPushToUser(username, payloadObj) {
    return new Promise((resolve) => {
      db.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE username = ?', [username], (err, rows) => {
        if (err) {
          console.error('DB error getting subscription', err);
          return resolve(false);
        }
        if (!rows.length) return resolve(false);
  
        const sub = {
          endpoint: rows[0].endpoint,
          keys: { p256dh: rows[0].p256dh, auth: rows[0].auth }
        };
        webpush.sendNotification(sub, JSON.stringify(payloadObj), { TTL: 60 })
        .then(() => resolve(true))
        .catch((e) => {
            console.error('Push send error for', username, e);
            const status = e?.statusCode || (e?.body && (() => { try { return JSON.parse(e.body).statusCode } catch(_) {return null} })());
            // If subscription is gone on the client, remove it server-side
            if (status === 410 || status === 404) {
              db.query('DELETE FROM push_subscriptions WHERE username = ?', [username], (delErr) => {
                if (delErr) console.error('Failed to delete expired subscription', delErr);
                else console.log('Deleted expired subscription for', username);
              });
            }
            resolve(false);
          });
      });
    });
  }
  

// Middleware to Check Login
function requireLogin(req, res, next) {
    if (!req.session.username) {
        return res.status(401).json({ message: 'Unauthorized: Please log in first' });
    }
    next();
}

function updateUserData() {
    fetch('/get-user-data')
        .then(response => response.json())
        .then(data => {
            console.log("User Data:", data); // Debugging line

            if (data.username) {
                document.getElementById('username').textContent = data.username;
                document.getElementById('balance').textContent = "$" + data.balance.toFixed(2);

                // Show admin panel link if user is an admin
                if (data.isAdmin) {
                    document.getElementById('admin-panel-link').style.display = 'block';
                }
            } else {
                window.location.href = '/login.html';
            }
        })
        .catch(error => console.error("Error fetching user data:", error));
}

function requireAdmin(req, res, next) {
    if (!req.session.username) {
        return res.status(401).json({ message: 'Unauthorized: Please log in first' });
    }

    db.query('SELECT admin FROM users WHERE username = ?', [req.session.username], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0 || !results[0].admin) {
            return res.status(403).json({ message: 'Access denied: Admins only' });
        }
        next();
    });
}


app.get('/', (req, res) => {
    if (!req.session.username) {
        return res.redirect('/login.html');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html')); // or whatever your main page is
    }
});

app.get('/usernames', requireLogin, (req, res) => {
    db.query('SELECT username FROM users', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results.map(user => user.username)); // Send array of usernames
    });
});

app.get("/check-admin", (req, res) => {
    if (!req.session.username) {
        return res.json({ admin: false });
    }

    db.query('SELECT admin FROM users WHERE username = ?', [req.session.username], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0 || results[0].admin !== 1) {
            return res.json({ admin: false });
        }
        res.json({ admin: true });
    });
});

app.get('/get-users', requireLogin, (req, res) => {
    db.query('SELECT username FROM users', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results.map(user => user.username));
    });
});

app.post('/update-balance', requireLogin, (req, res) => {
    const { username, amount } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!username || isNaN(parsedAmount)) {
        return res.status(400).json({ message: 'Invalid input' });
    }

    db.query('SELECT balance FROM users WHERE username = ?', [username], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: 'User not found' });

        db.query('UPDATE users SET balance = balance + ? WHERE username = ?', [parsedAmount, username], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Balance updated successfully' });
        });
    });
});

app.get('/get-balance/:username', requireLogin, (req, res) => {
    const { username } = req.params;
    db.query('SELECT COALESCE(balance, 0) AS balance FROM users WHERE username = ?', [username], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: 'User not found' });
        res.json({ balance: parseFloat(results[0].balance) });
    });
});

app.post('/delete-user', requireAdmin, (req, res) => {
    const { username } = req.body;

    if (username === 'admin') {
        return res.status(403).json({ error: "You can't delete the admin account." });
    }

    db.query('DELETE FROM users WHERE username = ?', [username], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'User deleted!' });
    });
});

// User Registration
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.query('INSERT INTO users (username, password, balance) VALUES (?, ?, 15)', [username, hashedPassword], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ message: 'Username already exists' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'User registered successfully!' });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error hashing password' });
    }
});

// User Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    console.log('🔑 Login attempt for:', username);
  
    db.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
      if (err) {
        console.error('❌ MySQL query error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
  
      console.log('🗄️  DB returned:', results);
      if (!results.length) {
        console.log('🚫 No user found:', username);
        return res.status(401).json({ message: 'Invalid credentials' });
      }
  
      try {
        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);
        console.log('🔒 Password match:', isMatch);
  
        if (!isMatch) {
          console.log('🚫 Wrong password for:', username);
          return res.status(401).json({ message: 'Invalid credentials' });
        }
  
        req.session.username = user.username;
        req.session.balance  = parseFloat(user.balance);
        console.log('✅ Login successful for:', username);
        return res.status(200).json({ message: 'Login successful!' });
  
      } catch (compareErr) {
        console.error('🔥 bcrypt error:', compareErr);
        return res.status(500).json({ message: 'Server error' });
      }
    });
  });

app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

    app.get('/get-transfer-history', requireLogin, (req, res) => {
        let username = req.session.username;
    
        db.getConnection((err, connection) => {
            if (err) return res.status(500).json({ error: 'Database connection error' });
    
            // ✅ Check if user is admin
            connection.query('SELECT admin FROM users WHERE username = ?', [username], (err, result) => {
                if (err || result.length === 0) {
                    connection.release();
                    return res.status(500).json({ error: 'Error checking admin status' });
                }
    
                const isAdmin = result[0].admin === 1;
    
                let query;
                let params;
    
                if (isAdmin) {
                    // ✅ Admin sees all transfers
                    query = 'SELECT * FROM transfers ORDER BY timestamp DESC';
                    params = [];
                } else {
                    // ✅ Regular users see only their transactions
                    query = 'SELECT * FROM transfers WHERE sender = ? OR receiver = ? ORDER BY timestamp DESC';
                    params = [username, username];
                }
    
                connection.query(query, params, (err, transfers) => {
                    connection.release();
                    if (err) {
                        return res.status(500).json({ error: 'Error fetching transfer history' });
                    }
    
                    res.json(transfers);
                });
            });
        });
    });


app.get('/get-user-data', (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: "Not logged in" });
    }

    db.query('SELECT username, balance FROM users WHERE username = ?', [req.session.username], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ error: "User not found" });

        res.json({ username: results[0].username, balance: parseFloat(results[0].balance) });
    });
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid'); // default session cookie name
      res.sendStatus(200);
    });
  });


app.post('/transfer', requireLogin, async (req, res) => {
    let { recipient, amount } = req.body;
    let sender = req.session.username;

    sender = sender.trim();
    recipient = recipient.trim();
    amount = parseFloat(amount);

    if (!recipient || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ message: 'Invalid recipient or amount' });
    }

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: 'Database connection error' });

        connection.beginTransaction(err => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: 'Transaction error' });
            }

            connection.query('SELECT balance FROM users WHERE username = ?', [sender], (err, senderResult) => {
                if (err || senderResult.length === 0) {
                    connection.rollback(() => connection.release());
                    return res.status(500).json({ error: 'Sender not found' });
                }

                const senderBalance = parseFloat(senderResult[0].balance);
                if (amount > senderBalance) {
                    connection.rollback(() => connection.release());
                    return res.status(400).json({ message: 'Insufficient balance' });
                }

                connection.query('SELECT balance FROM users WHERE username = ?', [recipient], (err, recipientResult) => {
                    if (err || recipientResult.length === 0) {
                        connection.rollback(() => connection.release());
                        return res.status(404).json({ message: 'Recipient not found' });
                    }

                    connection.query('UPDATE users SET balance = balance - ? WHERE username = ?', [amount, sender], (err) => {
                        if (err) {
                            connection.rollback(() => connection.release());
                            return res.status(500).json({ error: 'Error updating sender balance' });
                        }

                        connection.query('UPDATE users SET balance = balance + ? WHERE username = ?', [amount, recipient], (err) => {
                            if (err) {
                                connection.rollback(() => connection.release());
                                return res.status(500).json({ error: 'Error updating recipient balance' });
                            }

                            // ✅ NEW: Save transfer details in the transfers table
                            connection.query(
                                'INSERT INTO transfers (sender, receiver, amount, timestamp) VALUES (?, ?, ?, NOW())',
                                [sender, recipient, amount],
                                (err) => {
                                    if (err) {
                                        connection.rollback(() => connection.release());
                                        return res.status(500).json({ error: 'Error saving transfer record' });
                                    }

                                    connection.commit(err => {
                                        if (err) {
                                            connection.rollback(() => connection.release());
                                            return res.status(500).json({ error: 'Transaction commit failed' });
                                        }

                                        const notifyPayload = {
                                            title: `${sender} sent you $${amount.toFixed(2)}`,
                                            body: `${sender} transferred $${amount.toFixed(2)} to your account.`,
                                            icon: '/icon.png',          // your app icon in public/
                                            badge: '/badge.png',        // small monochrome icon for status bar (optional)
                                            tag: `transfer-${recipient}`, // groups/replace similar notifications
                                            renotify: true,
                                            data: {
                                              url: `/home.html?openFrom=${encodeURIComponent(sender)}`,
                                              sender,
                                              amount
                                            }
                                          };
                                          
                                          // fire-and-forget so transfer response stays snappy
                                          sendPushToUser(recipient, notifyPayload).then(ok => {
                                            if (!ok) console.log('Push not delivered (no subscription) for', recipient);
                                          });

                                        connection.release();
                                        res.json({ message: 'Transfer successful!', success: true });
                                    });
                                }
                            );
                        });
                    });
                });
            });
        });
    });
});


// Start Server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
