require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

// 1. PROPER MODEL IMPORT
const User = require(path.join(__dirname, '../models/User'));
const Event = require(path.join(__dirname, '../models/Event'));
const Ticket = require(path.join(__dirname, '../models/Ticket'));

const dbConfig = {
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 3000,
};

async function analyzeQueries() {
  let conn;
  try {
    // 2. CONNECT WITH ERROR HANDLING
    conn = await mongoose.connect(process.env.MONGODB_URI, dbConfig);
    console.log('✅ Connected to database');

    // 3. GET REAL SAMPLE DATA
    const [sampleUser] = await User.find().limit(1);
    const [sampleEvent] = await Event.find().limit(1);
    const [sampleTicket] = await Ticket.find().limit(1);

    if (!sampleUser || !sampleEvent || !sampleTicket) {
      throw new Error('No sample data found in database');
    }

    // 4. TICKET VALIDATION ANALYSIS
    console.log('\n🔍 Analyzing Ticket Validation...');
    const ticketExplain = await Ticket.findOne({ _id: sampleTicket._id })
      .populate('event')
      .populate('owner')
      .explain('executionStats');
    console.log(JSON.stringify(ticketExplain, null, 2));

    // 5. EVENT FILTERING ANALYSIS
    console.log('\n🔍 Analyzing Event Filtering...');
    const eventExplain = await Event.find({
      date: { $gt: new Date() },
      isActive: true,
    })
      .sort({ date: 1 })
      .explain('executionStats');
    console.log(JSON.stringify(eventExplain, null, 2));

    // 6. USER TICKETS ANALYSIS
    console.log('\n🔍 Analyzing User Tickets...');
    const userTicketsExplain = await Ticket.find({ owner: sampleUser._id })
      .populate('event')
      .explain('executionStats');
    console.log(JSON.stringify(userTicketsExplain, null, 2));
  } catch (err) {
    console.error('❌ Analysis failed:', err.message);
  } finally {
    if (conn) {
      await conn.disconnect();
      console.log('🔌 Disconnected from database');
    }
    process.exit();
  }
}

analyzeQueries();
