const Ticket = require('../models/Ticket');
const { AppError } = require('../middleware/errorHandler');

exports.processRefund = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { reason } = req.body;
    const idempotencyKey = req.idempotencyKey;
    const userId = req.user.id;

    // 1. Check for existing refund attempt (idempotency check)
    const existingRefund = await Ticket.findOne({
      _id: ticketId,
      'refundHistory.idempotencyKey': idempotencyKey,
    });

    if (existingRefund) {
      const refund = existingRefund.refundHistory.find(
        (r) => r.idempotencyKey === idempotencyKey
      );
      return res.status(200).json({
        status: 'deduplicated',
        refundStatus: refund.status,
        originalRequestAt: refund.processedAt,
      });
    }

    // 2. Find ticket and validate ownership
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      throw new AppError('Ticket not found', 404);
    }

    if (ticket.owner.toString() !== userId.toString()) {
      throw new AppError('You do not own this ticket', 403);
    }

    // 3. Process refund using model method
    await ticket.processRefund(reason, userId, idempotencyKey);

    // 4. Get the newly created refund record
    const newRefund = ticket.refundHistory.find(
      (r) => r.idempotencyKey === idempotencyKey
    );

    res.status(200).json({
      status: 'completed',
      amount: ticket.price,
      currency: 'SZL',
      refundId: newRefund._id,
      processedAt: newRefund.processedAt,
    });
  } catch (err) {
    next(err);
  }
};
