let admin;
try {
  admin = require('firebase-admin');
  if (!admin.apps || !admin.apps.length) {
    admin.initializeApp();
  }
} catch (e) {
  // Fallback stub for environments where firebase-admin is not installed locally
  admin = {
    apps: [],
    initializeApp: () => {},
    firestore: () => ({
      doc: () => ({ update: async () => {} }),
      FieldValue: { serverTimestamp: () => new Date().toISOString() }
    }),
    auth: () => ({
      getUserByEmail: async () => {},
      generatePasswordResetLink: async () => {}
    })
  };
}

const ACCESS_REQUESTS_COLLECTION = 'accessRequests';
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function setAdminInstance(customAdmin) {
  admin = customAdmin;
}

function validateAndNormalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.endsWith('fj')) return null;
  const normalized = trimmed.slice(0, -2).trim();
  if (!EMAIL_REGEX.test(normalized)) return null;
  return normalized;
}

exports.setAdminInstance = setAdminInstance;
exports.validateAndNormalizeEmail = validateAndNormalizeEmail;

exports.handleAccessRequest = async (event) => {
  const { doc } = event.data || {};
  if (!doc) return;

  const data = doc.data() || {};
  const { email, status, deliveryStatus } = data;
  const docRef = admin.firestore().doc(`${ACCESS_REQUESTS_COLLECTION}/${doc.id}`);

  // Handle new document creation
  if (event.type === 'create') {
    if (!email || typeof email !== 'string') {
      await docRef.update({
        status: 'rejected',
        error: 'Invalid or missing email address',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Check for 'fj' suffix
    if (trimmedEmail.endsWith('fj')) {
      const normalizedEmail = validateAndNormalizeEmail(trimmedEmail);

      if (!normalizedEmail) {
        await docRef.update({
          status: 'rejected',
          error: 'Email format after removing fj suffix is invalid',
          deliveryStatus: 'failed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
      }

      // Prevent duplicate email sending if already sent
      if (deliveryStatus === 'sent') {
        console.log(`Password reset already sent to ${normalizedEmail}`);
        return;
      }

      try {
        // Validate that user exists in Firebase Auth
        await admin.auth().getUserByEmail(normalizedEmail);

        // User exists: initiate password reset
        await docRef.update({
          status: 'approved',
          normalizedEmail,
          deliveryStatus: 'sending',
          approvedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Generate password reset link via Firebase Admin SDK
        const link = await admin.auth().generatePasswordResetLink(normalizedEmail);
        console.log(`Password reset link generated for ${normalizedEmail}: ${link}`);

        await docRef.update({
          deliveryStatus: 'sent',
          deliveryTimestamp: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (authError) {
        console.error(`Error processing email ${normalizedEmail}:`, authError);
        await docRef.update({
          status: 'rejected',
          error: authError.code === 'auth/user-not-found' 
            ? 'Firebase Authentication account does not exist' 
            : (authError.message || 'Authentication error'),
          deliveryStatus: 'failed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    } else {
      // No 'fj' suffix: Leave as pending for manual owner review
      await docRef.update({
        status: 'pending',
        deliveryStatus: 'pending',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } 
  // Handle status update from pending to approved
  else if (event.type === 'update' && status === 'approved') {
    // Prevent duplicate emails from repeated events or refreshes
    if (deliveryStatus === 'sent') {
      console.log('Password reset already delivered; skipping duplicate send.');
      return;
    }

    const targetEmail = data.normalizedEmail || email;
    if (!targetEmail) return;

    try {
      await admin.auth().getUserByEmail(targetEmail);
      const link = await admin.auth().generatePasswordResetLink(targetEmail);
      console.log(`Manual approval reset link generated for ${targetEmail}: ${link}`);

      await docRef.update({
        deliveryStatus: 'sent',
        deliveryTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error(`Error sending manual approval reset for ${targetEmail}:`, error);
      await docRef.update({
        deliveryStatus: 'failed',
        error: error.message || 'Delivery failed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }
};
