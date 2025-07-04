require('dotenv').config();
const mongoose = require('mongoose');

const dbConfig = {
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 3000,
};

// Load models
require('../models/User');
require('../models/Event');
require('../models/Ticket');

const indexDefinitions = {
  User: [
    { key: { email: 1 }, options: { unique: true, name: 'email_unique' } },
    { key: { role: 1 }, options: { name: 'role_index' } },
  ],
  Event: [
    { key: { date: 1, isActive: 1 }, options: { name: 'event_active_date' } },
    { key: { organizer: 1 }, options: { name: 'organizer_index' } },
  ],
  Ticket: [
    { key: { qrData: 1 }, options: { unique: true, name: 'qrData_unique' } },
    { key: { owner: 1 }, options: { name: 'owner_index' } },
    { key: { event: 1, isUsed: 1 }, options: { name: 'event_usage_status' } },
  ],
};

async function cleanLegacyIndexes() {
  const legacyIndexMap = {
    User: ['email_1'],
    Event: ['date_1_isActive_1'],
    Ticket: ['qrData_1'],
  };

  for (const [modelName, indexNames] of Object.entries(legacyIndexMap)) {
    const model = mongoose.model(modelName);
    const indexes = await model.collection.listIndexes().toArray();

    for (const indexName of indexNames) {
      if (indexes.some((idx) => idx.name === indexName)) {
        await model.collection.dropIndex(indexName);
        console.log(`♻️ Dropped legacy index ${modelName}.${indexName}`);
      }
    }
  }
}

async function createIndexes() {
  const results = [];

  for (const [modelName, indexes] of Object.entries(indexDefinitions)) {
    const model = mongoose.model(modelName);

    for (const { key, options } of indexes) {
      try {
        await model.collection.createIndex(key, options);
        results.push(`✓ Created ${options.name} for ${modelName}`);
      } catch (err) {
        if (err.code === 85) {
          // Index already exists (different name)
          results.push(
            `⏩ ${modelName}.${options.name}: Keeping existing equivalent`
          );
        } else {
          results.push(`⚠️ ${modelName}.${options.name}: ${err.message}`);
        }
      }
    }
  }

  return results;
}

async function runMigration() {
  try {
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI, dbConfig);

    console.log('🧹 Cleaning legacy indexes...');
    await cleanLegacyIndexes();

    console.log('⚙️ Creating optimized indexes...');
    const indexResults = await createIndexes();

    console.log('\n📊 Final Index Status:');
    console.log(indexResults.join('\n'));
    console.log('\n✅ PHASE 2 COMPLETE: Database fully optimized');
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
}

runMigration();
