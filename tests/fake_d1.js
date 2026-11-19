// Small deterministic D1 test double for Worker security tests.
class FakeD1 {
  constructor() {
    this.config = null;
    this.rates = new Map();
    this.sessions = new Map();
    this.invitations = new Map();
    this.users = new Map();
    this.palInvites = new Map();
    this.pals = new Set();
    this.messages = new Map();
  }

  prepare(sql) {
    const db = this;
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async first() {
        if (sql.includes("COUNT(*) AS count FROM registered_users")) return { count: [...db.users.values()].filter(user => user.status === "active").length };
        if (sql.includes("COUNT(*) AS count FROM pal_invitations")) return { count: [...db.palInvites.values()].filter(item => item.inviterUid === args[0] && item.createdAt > args[1]).length };
        if (sql.includes("COUNT(*) AS count FROM pip_messages")) return { count: [...db.messages.values()].filter(item => item.senderUid === args[0] && item.createdAt > args[1]).length };
        if (sql.includes("SELECT status, deletion_at AS deletionAt FROM registered_users")) {
          const user = db.users.get(args[0]); return user ? { status: user.status, deletionAt: user.deletionAt } : null;
        }
        if (sql.includes("SELECT status FROM registered_users")) return db.users.get(args[0]) ? { status: db.users.get(args[0]).status } : null;
        if (sql.includes("SELECT id, inviter_uid AS inviterUid FROM pal_invitations")) {
          const item = db.palInvites.get(args[0]);
          return item && item.emailDigest === args[1] && item.status === "pending" ? { id: item.id, inviterUid: item.inviterUid } : null;
        }
        if (sql.includes("UPDATE pal_invitations") && sql.includes("RETURNING id")) {
          const [status, recipientUid, id] = args;
          const item = db.palInvites.get(id);
          if (!item || item.status !== "pending") return null;
          item.status = status; item.recipientUid = recipientUid;
          return { id };
        }
        if (sql.includes("SELECT 1 AS allowed FROM pals")) return db.pals.has(`${args[0]}|${args[1]}`) ? { allowed: 1 } : null;
        if (sql.includes("SELECT uid FROM registered_users WHERE uid = ? AND status = 'scheduled'")) {
          const user = db.users.get(args[0]);
          return user?.status === "scheduled" && user.deletionAt <= args[1] ? { uid: args[0] } : null;
        }
        if (sql.includes("UPDATE registered_users SET status = 'active'")) {
          const [uid, now] = args; const user = db.users.get(uid);
          if (!user || user.status !== "scheduled" || user.deletionAt <= now) return null;
          user.status = "active"; user.deletionAt = null; return { uid };
        }
        if (sql.includes("FROM rate_limits")) return db.rates.get(args[0]) || null;
        if (sql.includes("FROM notes_config")) return db.config;
        if (sql.includes("UPDATE invitations")) {
          const [consumedAt, consumedBy, digest, now] = args;
          const record = db.invitations.get(digest);
          if (!record || record.consumedAt || record.expiresAt <= now) return null;
          record.consumedAt = consumedAt;
          record.consumedBy = consumedBy;
          return { token_digest: digest };
        }
        return null;
      },
      async run() {
        if (sql.includes("INSERT OR IGNORE INTO registered_users")) {
          if (!db.users.has(args[0])) db.users.set(args[0], { uid: args[0], registeredAt: args[1], displayName: args[2], status: "active", deletionAt: null });
        } else if (sql.includes("UPDATE registered_users SET display_name")) {
          const user = db.users.get(args[1]); if (user) user.displayName = args[0];
        } else if (sql.includes("UPDATE registered_users SET status = 'scheduled'")) {
          const user = db.users.get(args[1]); if (user && user.status === "active") { user.status = "scheduled"; user.deletionAt = args[0]; }
        } else if (sql.includes("INSERT INTO pal_invitations")) {
          const [id, emailDigest, inviterUid, inviterName, createdAt] = args;
          db.palInvites.set(id, { id, emailDigest, inviterUid, inviterName, status: "pending", createdAt, recipientUid: null });
        } else if (sql.includes("INSERT OR IGNORE INTO pals")) {
          db.pals.add(`${args[0]}|${args[1]}`);
        } else if (sql.includes("INSERT INTO pip_messages")) {
          const [id, senderUid, recipientUid, body, createdAt] = args;
          db.messages.set(id, { id, senderUid, recipientUid, body, createdAt, readAt: null });
        } else if (sql.includes("UPDATE pip_messages SET read_at")) {
          for (const message of db.messages.values()) if (message.senderUid === args[1] && message.recipientUid === args[2] && message.readAt === null) message.readAt = args[0];
        } else if (sql.includes("DELETE FROM pip_messages")) {
          for (const [id, message] of db.messages) if (message.senderUid === args[0] || message.recipientUid === args[1]) db.messages.delete(id);
        } else if (sql.includes("DELETE FROM pals")) {
          for (const pair of [...db.pals]) if (pair.split("|").includes(args[0]) || pair.split("|").includes(args[1])) db.pals.delete(pair);
        } else if (sql.includes("DELETE FROM pal_invitations")) {
          for (const [id, item] of db.palInvites) if (item.inviterUid === args[0] || item.recipientUid === args[1] || item.emailDigest === args[2]) db.palInvites.delete(id);
        } else if (sql.includes("DELETE FROM registered_users")) {
          db.users.delete(args[0]);
        }
        if (sql.includes("INSERT OR IGNORE INTO notes_config")) {
          if (!db.config) db.config = { saltHex: args[0], hashHex: args[1], version: 1 };
        } else if (sql.includes("INSERT INTO notes_config")) {
          db.config = { saltHex: args[0], hashHex: args[1], version: args[2] };
        } else if (sql.includes("INSERT INTO rate_limits")) {
          db.rates.set(args[0], { count: args[1], lockedUntil: args[2] });
        } else if (sql.includes("DELETE FROM rate_limits")) {
          db.rates.delete(args[0]);
        } else if (sql.includes("INSERT INTO active_sessions")) {
          db.sessions.set(args[0], { uid: args[1], expiresAt: args[2], revoked: false });
        } else if (sql.includes("UPDATE active_sessions")) {
          for (const record of db.sessions.values()) if (record.uid === args[0]) record.revoked = true;
        } else if (sql.includes("INSERT INTO invitations")) {
          db.invitations.set(args[0], { expiresAt: args[1], consumedAt: null, consumedBy: null });
        }
        return { success: true };
      },
      async all() {
        if (sql.includes("FROM pal_invitations")) {
          const [sender, senderMatch, emailDigest] = args;
          return { results: [...db.palInvites.values()].filter(item => item.status === "pending" && (item.inviterUid === senderMatch || item.emailDigest === emailDigest)).map(item => ({ id: item.id, inviterUid: item.inviterUid, inviterName: item.inviterName, status: item.status, createdAt: item.createdAt, direction: item.inviterUid === sender ? "sent" : "received" })) };
        }
        if (sql.includes("FROM pals p JOIN registered_users")) {
          const uid = args[0];
          return { results: [...db.pals].filter(pair => pair.split("|").includes(uid)).map(pair => {
            const palUid = pair.split("|").find(value => value !== uid);
            const pal = db.users.get(palUid);
            const unread = [...db.messages.values()].filter(message => message.senderUid === palUid && message.recipientUid === uid && message.readAt === null).length;
            return { uid: palUid, displayName: pal?.displayName || "", unread };
          }) };
        }
        if (sql.includes("FROM pip_messages WHERE")) {
          const [uid1, pal1, pal2, uid2] = args;
          return { results: [...db.messages.values()].filter(message => (message.senderUid === uid1 && message.recipientUid === pal1) || (message.senderUid === pal2 && message.recipientUid === uid2)).sort((a, b) => a.createdAt - b.createdAt) };
        }
        return { results: [] };
      }
    };
    return statement;
  }

  async batch(statements) {
    for (const statement of statements) await statement.run();
    return [];
  }
}

module.exports = { FakeD1 };
