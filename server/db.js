const crypto = require("node:crypto");
const { MongoClient } = require("mongodb");

const memory = { documents: new Map(), analyses: new Map(), tasks: new Map() };
let database;

function makeId() {
  return crypto.randomUUID();
}

async function connect() {
  if (!process.env.MONGODB_URI) {
    console.info("MONGODB_URI is not set; using the in-memory development database. Data will not persist after restart.");
    return;
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  database = client.db(process.env.MONGODB_DB || "lifelens");
  await Promise.all([
    database.collection("analyses").createIndex({ hash: 1, role: 1 }, { unique: true }),
    database.collection("tasks").createIndex({ documentId: 1 })
  ]);
  console.info(`Connected to MongoDB database "${database.databaseName}".`);
}

async function getCachedAnalysis(hash, role) {
  const cacheKey = `${hash}:${role}`;
  if (!database) {
    const cached = memory.analyses.get(cacheKey);
    return cached ? {
      ...cached,
      tasks: cached.tasks.map((task) => ({ ...task, id: task._id })),
      cached: true
    } : null;
  }
  const cached = await database.collection("analyses").findOne({ hash, role });
  if (!cached) return null;
  const tasks = await database.collection("tasks").find({ documentId: cached.documentId }).toArray();
  return {
    ...cached,
    tasks: tasks.map(({ _id, ...task }) => ({ ...task, id: _id })),
    cached: true
  };
}

async function saveAnalysis({ hash, text, role, analysis }) {
  const cacheKey = `${hash}:${role}`;
  if (!database) {
    const cached = await getCachedAnalysis(hash, role);
    if (cached) return cached;
    const documentId = makeId();
    const document = { _id: documentId, hash, text, createdAt: new Date().toISOString() };
    const tasks = analysis.actions.map((action) => ({
      _id: makeId(), documentId, action: action.action, evidence: action.evidence,
      deadline: action.deadline, deadlineText: action.deadlineText, priority: action.priority,
      consequence: action.consequence, status: "pending", reminders: {}, createdAt: new Date().toISOString()
    }));
    const record = { documentId, hash, role, analysis, tasks };
    memory.documents.set(documentId, document);
    memory.analyses.set(cacheKey, record);
    for (const task of tasks) memory.tasks.set(task._id, task);
    return { ...record, tasks: tasks.map((task) => ({ ...task, id: task._id })), cached: false };
  }
  const collection = database.collection("analyses");
  const cached = await getCachedAnalysis(hash, role);
  if (cached) {
    return cached;
  }
  const documentId = makeId();
  await database.collection("documents").insertOne({ _id: documentId, hash, text, createdAt: new Date() });
  const tasks = analysis.actions.map((action) => ({
    _id: makeId(), documentId, action: action.action, evidence: action.evidence,
    deadline: action.deadline, deadlineText: action.deadlineText, priority: action.priority,
    consequence: action.consequence, status: "pending", reminders: {}, createdAt: new Date()
  }));
  try {
    await Promise.all([
      collection.insertOne({ _id: `${hash}:${role}`, documentId, hash, role, analysis, createdAt: new Date() }),
      ...(tasks.length ? [database.collection("tasks").insertMany(tasks)] : [])
    ]);
  } catch (error) {
    if (error.code === 11000) {
      const winner = await collection.findOne({ hash, role });
      if (winner) {
        const existingTasks = await database.collection("tasks").find({ documentId: winner.documentId }).toArray();
        return { ...winner, tasks: existingTasks.map(({ _id, ...task }) => ({ ...task, id: _id })), cached: true };
      }
    }
    throw error;
  }
  return { documentId, hash, role, analysis, tasks: tasks.map(({ _id, ...task }) => ({ ...task, id: _id })), cached: false };
}

async function updateTask(id, status) {
  if (!database) {
    const task = memory.tasks.get(id);
    if (!task) return null;
    task.status = status;
    task.updatedAt = new Date().toISOString();
    return { ...task, id };
  }
  const result = await database.collection("tasks").findOneAndUpdate(
    { _id: id }, { $set: { status, updatedAt: new Date() } }, { returnDocument: "after" }
  );
  if (!result) return null;
  const { _id, ...task } = result;
  return { ...task, id: _id };
}

async function getDueTasks(until) {
  if (!database) return [...memory.tasks.entries()]
    .map(([id, task]) => ({ ...task, id }))
    .filter((task) => task.status === "pending" && task.deadline && task.deadline <= until);
  const tasks = await database.collection("tasks").find({
    status: "pending", deadline: { $ne: null, $lte: until }
  }).toArray();
  return tasks.map(({ _id, ...task }) => ({ ...task, id: _id }));
}

async function markReminder(id, channel, state) {
  if (!database) {
    const task = memory.tasks.get(id);
    if (!task) throw new Error(`Cannot update reminder state: task ${id} was not found.`);
    task.reminders[channel] = state;
    return;
  }
  const result = await database.collection("tasks").updateOne(
    { _id: id }, { $set: { [`reminders.${channel}`]: state } }
  );
  if (!result.matchedCount) throw new Error(`Cannot update reminder state: task ${id} was not found.`);
}

module.exports = { connect, getCachedAnalysis, saveAnalysis, updateTask, getDueTasks, markReminder };
