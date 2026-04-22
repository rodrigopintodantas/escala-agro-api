var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cors = require('cors');
var indexRouter = require('./routes/index');
var errorHandler = require('./auth/error-handler');
var app = express();

const corsOptions = {
  origin: '*',
  methods: 'GET,HEAD,PUT,POST,DELETE,PATCH',
  allowedHeaders: [
    'Content-type',
    'X-Requested-With',
    'Origin',
    'Accept',
    'authorization',
    'up',
  ],
  optionsSuccessStatus: 200,
  exposedHeaders: ['Authorization'],
};

app.use(cors(corsOptions));
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', indexRouter);

app.use(errorHandler);

module.exports = app;
