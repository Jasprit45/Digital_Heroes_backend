const express = require('express');
const multer = require('multer');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const userWinningsController = require('./userWinnings.controller');
const adminWinnersController = require('./adminWinners.controller');

// Configure multer for memory storage and file limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'), false);
    }
  }
});

const userWinningsRouter = express.Router();
const adminWinnersRouter = express.Router();

// --- USER ROUTES ---
userWinningsRouter.use(authenticate);

userWinningsRouter.get('/', userWinningsController.getUserWinnings);
userWinningsRouter.post('/:id/proof', upload.single('proof'), userWinningsController.uploadProof);

// --- ADMIN ROUTES ---
adminWinnersRouter.use(authenticate, requireRole('ADMIN'));

adminWinnersRouter.get('/', adminWinnersController.getAdminWinners);
adminWinnersRouter.patch('/:id/verify', adminWinnersController.verifyWinner);
adminWinnersRouter.patch('/:id/payout', adminWinnersController.payWinner);
adminWinnersRouter.get('/:id/proof-url', adminWinnersController.generateProofUrl);

// Error handler for multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      status: 'error',
      message: err.message
    });
  }
  next(err);
};

userWinningsRouter.use(handleMulterError);

module.exports = {
  userWinningsRouter,
  adminWinnersRouter
};
