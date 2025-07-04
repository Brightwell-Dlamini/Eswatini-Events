const request = require('supertest');
const app = require('../app');
const logger = require('../utils/logger');

describe('Payment Webhooks', () => {
  const validPayload = {
    transactionId: 'txn_123',
    status: 'success',
    ticketIds: ['507f1f77bcf86cd799439011'],
  };

  it('should reject requests without signature', async () => {
    const res = await request(app)
      .post('/api/tickets/webhook/payment')
      .send(validPayload)
      .expect(401);

    expect(res.body.message).toMatch(/signature/);
  });

  it('should process valid webhooks', async () => {
    const res = await request(app)
      .post('/api/tickets/webhook/payment')
      .set('x-payment-signature', process.env.PAYMENT_WEBHOOK_SECRET)
      .send(validPayload)
      .expect(200);

    expect(res.body.acknowledged).toBe(true);
  });
});
