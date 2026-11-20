let admin;
try {
  admin = require('firebase-admin');
  if (!admin.apps || !admin.apps.length) {
    admin.initializeApp();
  }
} catch {
  admin = null;
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
  return localPart.endsWith('fj') ? trimmed : null;
}

exports.setAdminInstance = setAdminInstance;
exports.validateAndNormalizeEmail = validateAndNormalizeEmail;

exports.handleAccessRequest = async (event) => {
  const { doc } = event.data || {};
  if (!doc) return;
  if (!admin) throw new Error('Firebase Admin SDK is unavailable');

  const data = doc.data() || {};
  if (event.type !== 'create' || data.status !== 'pending') return;

  const firestore = admin.firestore();
  const docRef = firestore.doc(`${ACCESS_REQUESTS_COLLECTION}/${doc.id}`);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const uid = typeof data.uid === 'string' ? data.uid : '';
  if (!EMAIL_REGEX.test(email) || !uid || uid !== doc.id || uid.length > 128) {
    await docRef.update({
      status: 'rejected',
      deliveryStatus: 'failed',
      error: 'A valid account email and matching Firebase UID are required',
      updatedAt: now
    });
    return;
  }

  const approvedEmail = validateAndNormalizeEmail(email);
  if (!approvedEmail) return;

  let userRecord;
  try {
    userRecord = await admin.auth().getUser(uid);
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      await docRef.update({
        status: 'rejected',
        deliveryStatus: 'failed',
        error: 'Firebase Authentication account does not exist',
        updatedAt: now
      });
      return;
    }
    throw error;
  }
  const authenticatedEmail = typeof userRecord.email === 'string' ? userRecord.email.trim().toLowerCase() : '';
  if (userRecord.emailVerified !== true || authenticatedEmail !== approvedEmail) {
    await docRef.update({
      status: 'pending',
      deliveryStatus: 'pending',
      error: 'Verified Firebase email matching the request is required',
      updatedAt: now
    });
    return;
  }

  const batch = firestore.batch();
  batch.set(firestore.doc(`users/${uid}`), { approved: true }, { merge: true });
  batch.update(docRef, {
    status: 'approved',
    deliveryStatus: 'not_required',
    approvalSource: 'verified_fj_email',
    approvedAt: now,
    updatedAt: now
  });
  await batch.commit();
};
