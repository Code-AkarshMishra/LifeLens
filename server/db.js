const crypto = require("node:crypto");
const { MongoClient } = require("mongodb");

const memory = {
  documents: new Map(),
  analyses: new Map(),
  tasks: new Map(),
  users: new Map(),
  usersByEmail: new Map(),
  sessions: new Map()
};
let database;

function makeId() {
  return crypto.randomUUID();
}

function publicTask(task) {
  const { _id, ownerId, ...fields } = task;
  return { ...fields, id: _id };
}

function publicUser(user) {
  if (!user) return null;
  const { _id, passwordHash, passwordSalt, ...fields } = user;
  return fields;
}

async function connect() {
  if (process.env.NODE_ENV === "test" || !process.env.MONGODB_URI) {
    console.info("MONGODB_URI is not set; using the in-memory development database. Data will not persist after restart.");
    return;
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  database = client.db(process.env.MONGODB_DB || "lifelens");
  await database.collection("analyses").dropIndex("hash_1_role_1").catch((error) => {
    if (![26, 27].includes(error.code)) throw error;
  });
  await Promise.all([
    database.collection("analyses").createIndex({ ownerId: 1, hash: 1, role: 1 }, { unique: true }),
    database.collection("tasks").createIndex({ ownerId: 1, documentId: 1 }),
    database.collection("users").createIndex({ email: 1 }, { unique: true }),
    database.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
    database.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ]);
  console.info(`Connected to MongoDB database "${database.databaseName}".`);
}

async function createUser(user) {
  const record = {
    _id: makeId(),
    ...user,
    emailReminders: true,
    whatsappReminders: false,
    phoneVerified: false,
    createdAt: new Date()
  };
  if (!database) {
    if (memory.usersByEmail.has(record.email)) return null;
    memory.users.set(record._id, record);
    memory.usersByEmail.set(record.email, record._id);
    return { user: publicUser(record), userId: record._id };
  }
  try {
    await database.collection("users").insertOne(record);
    return { user: publicUser(record), userId: record._id };
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
}

async function findUserByEmail(email) {
  if (!database) {
    const id = memory.usersByEmail.get(email);
    return id ? { ...memory.users.get(id) } : null;
  }
  return database.collection("users").findOne({ email });
}

async function findUserById(id) {
  if (!database) return memory.users.get(id) || null;
  return database.collection("users").findOne({ _id: id });
}

async function updateUserPreferences(userId, preferences) {
  if (!database) {
    const user = memory.users.get(userId);
    if (!user) return null;
    Object.assign(user, preferences, { updatedAt: new Date() });
    return publicUser(user);
  }
  const updated = await database.collection("users").findOneAndUpdate(
    { _id: userId },
    { $set: { ...preferences, updatedAt: new Date() } },
    { returnDocument: "after", projection: { passwordHash: 0, passwordSalt: 0 } }
  );
  return updated ? publicUser(updated) : null;
}

async function createSession({ tokenHash, userId, expiresAt }) {
  const session = { _id: makeId(), tokenHash, userId, expiresAt };
  if (!database) {
    memory.sessions.set(tokenHash, session);
    return;
  }
  await database.collection("sessions").insertOne(session);
}

async function getSessionUser(tokenHash) {
  const now = new Date();
  let session;
  if (!database) {
    session = memory.sessions.get(tokenHash);
    if (session && session.expiresAt <= now) {
      memory.sessions.delete(tokenHash);
      session = null;
    }
  } else {
    session = await database.collection("sessions").findOne({ tokenHash, expiresAt: { $gt: now } });
  }
  if (!session) return null;
  const user = await findUserById(session.userId);
  return user ? { ...publicUser(user), id: session.userId } : null;
}

async function deleteSession(tokenHash) {
  if (!tokenHash) return;
  if (!database) {
    memory.sessions.delete(tokenHash);
    return;
  }
  await database.collection("sessions").deleteOne({ tokenHash });
}

async function getCachedAnalysis(ownerId, hash, role) {
  const cacheKey = `${ownerId}:${hash}:${role}`;
  if (!database) {
    const cached = memory.analyses.get(cacheKey);
    return cached ? {
      ...cached,
      tasks: cached.tasks.map(publicTask),
      cached: true
    } : null;
  }
  const cached = await database.collection("analyses").findOne({ ownerId, hash, role });
  if (!cached) return null;
  const taskCollection = database.collection("tasks");
  let tasks = await taskCollection.find({ ownerId, documentId: cached.documentId }).toArray();
  for (let attempt = 0; attempt < 20 && tasks.length < (cached.actionCount || 0); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    tasks = await taskCollection.find({ ownerId, documentId: cached.documentId }).toArray();
  }
  return { ...cached, tasks: tasks.map(publicTask), cached: true };
}

async function saveAnalysis({ ownerId, hash, text, role, analysis }) {
  const cacheKey = `${ownerId}:${hash}:${role}`;
  if (!database) {
    const existing = memory.analyses.get(cacheKey);
    if (existing) return { ...existing, tasks: existing.tasks.map(publicTask), cached: true };
    const documentId = makeId();
    const now = new Date();
    const tasks = analysis.actions.map((action) => ({
      _id: makeId(), ownerId, documentId, action: action.action, evidence: action.evidence,
      deadline: action.deadline, deadlineText: action.deadlineText, priority: action.priority,
      consequence: action.consequence, consequenceEvidence: action.consequenceEvidence,
      status: "pending", reminders: {}, createdAt: now
    }));
    const record = { documentId, ownerId, hash, role, analysis, tasks, createdAt: now };
    memory.documents.set(documentId, { _id: documentId, ownerId, hash, text, createdAt: now });
    memory.analyses.set(cacheKey, record);
    for (const task of tasks) memory.tasks.set(task._id, task);
    return { ...record, tasks: tasks.map(publicTask), cached: false };
  }
  const cached = await getCachedAnalysis(ownerId, hash, role);
  if (cached) return cached;
  const documentId = makeId();
  const now = new Date();
  const tasks = analysis.actions.map((action) => ({
    _id: makeId(), ownerId, documentId, action: action.action, evidence: action.evidence,
    deadline: action.deadline, deadlineText: action.deadlineText, priority: action.priority,
    consequence: action.consequence, consequenceEvidence: action.consequenceEvidence,
    status: "pending", reminders: {}, createdAt: now
  }));
  const analyses = database.collection("analyses");
  try {
    await database.collection("documents").insertOne({ _id: documentId, ownerId, hash, text, createdAt: now });
    await analyses.insertOne({
      _id: `${ownerId}:${hash}:${role}`, documentId, ownerId, hash, role,
      analysis, actionCount: tasks.length, createdAt: now
    });
    if (tasks.length) await database.collection("tasks").insertMany(tasks);
  } catch (error) {
    if (error.code === 11000) {
      const ownAnalysis = await analyses.findOne({ _id: `${ownerId}:${hash}:${role}`, documentId });
      if (ownAnalysis) {
        await Promise.all([
          analyses.deleteOne({ _id: `${ownerId}:${hash}:${role}`, documentId }),
          database.collection("tasks").deleteMany({ ownerId, documentId }),
          database.collection("documents").deleteOne({ _id: documentId, ownerId })
        ]);
        throw error;
      }
      await database.collection("documents").deleteOne({ _id: documentId, ownerId });
      const winner = await getCachedAnalysis(ownerId, hash, role);
      if (winner) return winner;
    } else {
      await Promise.all([
        analyses.deleteOne({ _id: `${ownerId}:${hash}:${role}`, documentId }),
        database.collection("tasks").deleteMany({ ownerId, documentId }),
        database.collection("documents").deleteOne({ _id: documentId, ownerId })
      ]);
    }
    throw error;
  }
  return { documentId, ownerId, hash, role, analysis, tasks: tasks.map(publicTask), cached: false };
}

async function updateTask(ownerId, id, status) {
  if (!database) {
    const task = memory.tasks.get(id);
    if (!task || task.ownerId !== ownerId) return null;
    task.status = status;
    task.updatedAt = new Date();
    return publicTask(task);
  }
  const result = await database.collection("tasks").findOneAndUpdate(
    { _id: id, ownerId }, { $set: { status, updatedAt: new Date() } }, { returnDocument: "after" }
  );
  return result ? publicTask(result) : null;
}

async function findOwnedTask(ownerId, id) {
  let task;
  if (!database) {
    task = memory.tasks.get(id);
    if (!task || task.ownerId !== ownerId) return null;
  } else {
    task = await database.collection("tasks").findOne({ _id: id, ownerId });
    if (!task) return null;
  }
  const owner = await findUserById(ownerId);
  return owner ? { ...publicTask(task), ownerId, owner: publicUser(owner) } : null;
}

async function getDueTasks(until) {
  let tasks;
  if (!database) {
    tasks = [...memory.tasks.values()].filter((task) => task.status === "pending" && task.deadline && task.deadline <= until);
  } else {
    tasks = await database.collection("tasks").find({
      status: "pending", deadline: { $ne: null, $lte: until }
    }).toArray();
  }
  const due = [];
  for (const task of tasks) {
    const owner = await findUserById(task.ownerId);
    if (owner) due.push({ ...publicTask(task), ownerId: task.ownerId, owner: publicUser(owner) });
  }
  return due;
}

async function claimReminder(ownerId, id, channel, now = new Date()) {
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
  if (!database) {
    const task = memory.tasks.get(id);
    if (!task || task.ownerId !== ownerId || task.status !== "pending") return false;
    const reminder = task.reminders[channel] || {};
    if (reminder.sentAt || reminder.status === "sent") return false;
    if (reminder.status === "sending" && reminder.claimedAt > staleBefore) return false;
    task.reminders[channel] = { status: "sending", claimedAt: now };
    return true;
  }
  const prefix = `reminders.${channel}`;
  const result = await database.collection("tasks").updateOne({
    _id: id,
    ownerId,
    status: "pending",
    [`${prefix}.sentAt`]: { $exists: false },
    $or: [
      { [`${prefix}.status`]: { $ne: "sending" } },
      { [`${prefix}.claimedAt`]: { $exists: false } },
      { [`${prefix}.claimedAt`]: { $lt: staleBefore } }
    ]
  }, {
    $set: { [`${prefix}.status`]: "sending", [`${prefix}.claimedAt`]: now }
  });
  return result.modifiedCount === 1;
}

async function markReminder(ownerId, id, channel, state) {
  if (!database) {
    const task = memory.tasks.get(id);
    if (!task || task.ownerId !== ownerId) throw new Error(`Cannot update reminder state: task ${id} was not found.`);
    task.reminders[channel] = state;
    return;
  }
  const result = await database.collection("tasks").updateOne(
    { _id: id, ownerId }, { $set: { [`reminders.${channel}`]: state } }
  );
  if (!result.matchedCount) throw new Error(`Cannot update reminder state: task ${id} was not found.`);
}

async function claimImmediateEmail(ownerId, id, now = new Date()) {
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
  const prefix = "reminders.emailImmediate";
  if (!database) {
    const task = memory.tasks.get(id);
    if (!task || task.ownerId !== ownerId || task.status !== "pending") return false;
    const reminder = task.reminders.emailImmediate || {};
    if (reminder.sentAt || (reminder.status === "sending" && reminder.claimedAt > staleBefore)) return false;
    task.reminders.emailImmediate = { status: "sending", attemptedAt: now, claimedAt: now };
    return true;
  }
  const result = await database.collection("tasks").updateOne({
    _id: id,
    ownerId,
    status: "pending",
    [`${prefix}.sentAt`]: { $exists: false },
    $or: [
      { [`${prefix}.status`]: { $ne: "sending" } },
      { [`${prefix}.claimedAt`]: { $exists: false } },
      { [`${prefix}.claimedAt`]: { $lt: staleBefore } }
    ]
  }, {
    $set: {
      [`${prefix}.status`]: "sending",
      [`${prefix}.attemptedAt`]: now,
      [`${prefix}.claimedAt`]: now
    }
  });
  return result.modifiedCount === 1;
}

async function markImmediateEmail(ownerId, id, state) {
  if (!database) {
    const task = memory.tasks.get(id);
    if (!task || task.ownerId !== ownerId) throw new Error(`Cannot update immediate email reminder: task ${id} was not found.`);
    task.reminders.emailImmediate = state;
    return;
  }
  const result = await database.collection("tasks").updateOne(
    { _id: id, ownerId }, { $set: { "reminders.emailImmediate": state } }
  );
  if (!result.matchedCount) throw new Error(`Cannot update immediate email reminder: task ${id} was not found.`);
}

module.exports = {
  connect, createUser, findUserByEmail, updateUserPreferences,
  createSession, getSessionUser, deleteSession,
  getCachedAnalysis, saveAnalysis, updateTask, findOwnedTask, getDueTasks,
  markReminder, claimReminder, claimImmediateEmail, markImmediateEmail
};
