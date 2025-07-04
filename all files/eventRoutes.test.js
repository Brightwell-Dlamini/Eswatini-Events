const request = require('supertest');
const app = require('../app');
const Event = require('../models/Event');

describe('GET /events/active', () => {
  beforeEach(async () => {
    // Seed test data
    await Event.create([
      {
        name: 'Future Event',
        date: new Date(Date.now() + 86400000), // Tomorrow
        isActive: true,
        ticketTypes: [{ name: 'General', price: 200 }],
      },
      {
        name: 'Past Event',
        date: new Date(Date.now() - 86400000), // Yesterday
        isActive: false,
      },
    ]);
  });

  it('returns only active events sorted by date', async () => {
    const res = await request(app).get('/api/events/active');
    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].name).toBe('Future Event');
  });
});
