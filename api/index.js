const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
      console.error('FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
    } else {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
      });
    }
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
  }
}

// Middleware to verify Firebase ID token
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying token:', error);
    return res.status(403).json({ error: 'Unauthorized: Invalid token', details: error.message });
  }
};

async function sendMulticastNotification(payload, excludeUid) {
  try {
    const usersSnapshot = await admin.firestore().collection('users').get();
    const tokens = [];

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      if (userData.fcmToken && doc.id !== excludeUid) {
        tokens.push(userData.fcmToken);
      }
    });

    if (tokens.length > 0) {
      const response = await admin.messaging().sendEachForMulticast({
        tokens: tokens,
        notification: payload.notification,
        webpush: {
          fcmOptions: {
            link: payload.link || '/'
          }
        }
      });
      console.log(`Successfully sent ${response.successCount} messages.`);
      return response;
    } else {
      console.log('No valid FCM tokens found to notify.');
      return { successCount: 0 };
    }
  } catch (error) {
    console.error('Error sending push notifications:', error);
    throw error;
  }
}

app.post('/api/notify/resource', authenticateUser, async (req, res) => {
  try {
    const { title, description } = req.body;
    const uploaderId = req.user.uid;

    const payload = {
      notification: {
        title: "New Resource Uploaded",
        body: title || "A new resource is available.",
      },
      link: '/'
    };

    const result = await sendMulticastNotification(payload, uploaderId);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notify/notice', authenticateUser, async (req, res) => {
  try {
    const { title, description } = req.body;
    const creatorId = req.user.uid;

    const payload = {
      notification: {
        title: "New Notice Posted",
        body: description || "A new notice was posted.",
      },
      link: '/'
    };

    const result = await sendMulticastNotification(payload, creatorId);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notify/message', authenticateUser, async (req, res) => {
  try {
    const { content, senderName } = req.body;
    const senderId = req.user.uid;

    const payload = {
      notification: {
        title: `New Message from ${senderName || 'Someone'}`,
        body: content || "Sent an attachment.",
      },
      link: '/community'
    };

    const result = await sendMulticastNotification(payload, senderId);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.status(200).send('Vellapaper Notification Backend is Running!');
});

module.exports = app;
