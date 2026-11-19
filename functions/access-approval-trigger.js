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
  if (!EMAIL_REGEX.test(trimmed)) return null;
  const at = trimmed.lastIndexOf('@');
  if (at < 1) return null;
  const localPart = trimmed.slice(0, at);
  if (localPart.endsWith('fj')) return trimmed;
  if (trimmed.endsWith('fj') && trimmed.includes('@')) {
    const normalized = trimmed.slice(0, -2);
    return EMAIL_REGEX.test(normalized) ? normalized : null;
  }
  return null;
}

exports.setAdminInstance = setAdminInstance;
exports.validateAndNormalizeEmail = validateAndNormalizeEmail;

exports.handleAccessRequest = async (event) => {
  const { doc } = event.data || {};
  if (!doc) return;

  const data = doc.data() || {};
  const { email, status, deliveryStatus } = data;
  const docRef = admin.firestore().doc(`${ACCESS_REQUESTS_COLLECTION}/${doc.id}`);

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
    if (!EMAIL_REGEX.test(trimmedEmail) && trimmedEmail.includes('@') === false && !trimmedEmail.endsWith('fj')) {
      await docRef.update({
        status: 'rejected',
        error: 'Invalid email address',
        deliveryStatus: 'failed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return;
    }
    const normalizedEmail = validateAndNormalizeEmail(email);
    if (!normalizedEmail) {
      if (trimmedEmail.endsWith('fj') && !trimmedEmail.includes('@')) {
        await docRef.update({
          status: 'rejected',
          error: 'Email format after removing fj suffix is invalid',
          deliveryStatus: 'failed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
      }
      await docRef.update({
        status: 'pending',
        deliveryStatus: 'pending',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return;
    }

    if (deliveryStatus === 'sent') return;

    try {
      const userRecord = await admin.auth().getUserByEmail(normalizedEmail);
      const hasPasswordAuth = !userRecord.providerData || userRecord.providerData.length === 0
        || userRecord.providerData.some(p => p.providerId === 'password');
      if (!hasPasswordAuth) {
        await docRef.update({
          status: 'ACTION_REQUIRED',
          error: 'Account uses federated sign-in only. Password reset is not applicable.',
          deliveryStatus: 'skipped',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
      }

      await docRef.update({
        status: 'approved',
        normalizedEmail,
        deliveryStatus: 'sending',
        idempotencyKey: `${doc.id}_v${data.approvalVersion || 1}_pwd_reset`,
        approvedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await admin.auth().generatePasswordResetLink(normalizedEmail);
      await docRef.update({
        deliveryStatus: 'sent',
        firebaseAccepted: true,
        deliveryTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (authError) {
      const temporary = authError.code === 'auth/network-timeout' || authError.code === 'auth/internal-error';
      await docRef.update({
        status: temporary ? 'pending' : 'rejected',
        error: authError.code === 'auth/user-not-found'
          ? 'Firebase Authentication account does not exist'
          : (authError.message || 'Authentication error'),
        deliveryStatus: temporary ? 'DELIVERY_UNKNOWN' : 'failed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } else if (event.type === 'update' && status === 'approved') {
    if (deliveryStatus === 'sent') return;
    const targetEmail = data.normalizedEmail || email;
    if (!targetEmail) return;

    try {
      await admin.auth().getUserByEmail(targetEmail);
      await admin.auth().generatePasswordResetLink(targetEmail);
      await docRef.update({
        deliveryStatus: 'sent',
        deliveryTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      await docRef.update({
        deliveryStatus: 'failed',
        error: error.message || 'Delivery failed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }
};
