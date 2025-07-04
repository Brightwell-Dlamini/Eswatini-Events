const winston = require('winston');
const { format } = winston;
const DailyRotateFile = require('winston-daily-rotate-file');

// Custom format that includes request ID if available
const requestAwareFormat = format((info) => {
  if (info.requestId) {
    info.requestId = info.requestId;
  }
  return info;
});

// Base format for all logs
const logFormat = format.combine(
  requestAwareFormat(),
  format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss',
  }),
  format.errors({ stack: true }),
  format.json()
);

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // Console output (colored, simplified for dev)
    new winston.transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf((info) => {
          const { timestamp, level, message, requestId, ...rest } = info;
          return `[${timestamp}] ${level}${
            requestId ? ` [${requestId}]` : ''
          }: ${message} ${
            Object.keys(rest).length ? JSON.stringify(rest) : ''
          }`;
        })
      ),
    }),

    // Daily rotating file transport (all logs)
    new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: logFormat,
    }),

    // Separate error logs
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '90d',
      level: 'error',
      format: logFormat,
    }),
  ],
});

// Add stream for Express morgan logging
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

module.exports = logger;
