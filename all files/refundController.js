const Ticket = require('../models/Ticket');
exports.processRefund = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { reason } = req.body;
    const idempotencyKey = req.idempotencyKey;

    // 1. Check for existing refund attempt
    const existingRefund = await Ticket.findOne({
      _id: ticketId,
      'refundHistory.idempotencyKey': idempotencyKey,
    });

    if (existingRefund) {
      const refund = existingRefund.refundHistory.find(
        (r) => r.idempotencyKey === idempotencyKey
      );
      return res.json({
        status: 'deduplicated',
        refundStatus: refund.status,
        originalRequestAt: refund.processedAt,
      });
    }

    // 2. Process new refund
    const ticket = await Ticket.findById(ticketId);
    ticket.refundHistory.push({
      idempotencyKey,
      processedAt: new Date(),
      processedBy: req.user.id,
      amount: ticket.price,
      reason,
      status: 'COMPLETED',
    });

    await ticket.save();

    res.json({
      status: 'completed',
      amount: ticket.price,
      currency: 'SZL',
    });
  } catch (err) {
    next(err);
  }
};
