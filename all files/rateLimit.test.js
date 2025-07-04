const request = require('supertest');
const app = require('../app');
describe('Rate Limiting', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(app); // Create agent once for the suite
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(() => resolve(), 20000)); // Wait 20s to reset rate limit (adjust as needed)
  });

  it('should block auth endpoints after 10 attempts', async () => {
    for (let i = 0; i < 9; i++) {
      await agent
        .post('/api/auth/login')
        .send({ email: `test${i}@test.com`, password: 'wrong' })
        .expect(401); // Expect 401 for first 9
    }
    await agent
      .post('/api/auth/login')
      .send({ email: 'test10@test.com', password: 'wrong' })
      .expect(429); // Expect 429 on 10th due to rate limit
  });

  it('should block after 100 requests to any endpoint', async () => {
    for (let i = 0; i < 100; i++) {
      await agent.get('/api/health').expect(200);
    }
    await agent.get('/api/health').expect(429);
  });
});
