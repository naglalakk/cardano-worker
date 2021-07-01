const winston = require('winston');
const winstonRotator = require('winston-daily-rotate-file');

var logger = new winston.createLogger({
  transports: [
    new (winston.transports.DailyRotateFile)({
      name: 'access-file',
      level: 'info',
      filename: './logs/access.log',
      json: false,
      datePattern: 'yyyy-MM-DD',
      prepend: true,
      maxFiles: 10
    }),
    new (winston.transports.DailyRotateFile)({
      name: 'error-file',
      level: 'error',
      filename: './logs/error.log',
      json: false,
      datePattern: 'yyyy-MM-DD',
      prepend: true,
      maxFiles: 10
    })
  ]
});


module.exports = {
  logger
};
