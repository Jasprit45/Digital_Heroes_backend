const WinnerService = require('./winner.service');

exports.getUserWinnings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const winnings = await WinnerService.getUserWinnings(userId);
    
    res.json({
      status: 'success',
      data: winnings
    });
  } catch (error) {
    next(error);
  }
};

exports.uploadProof = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id: winnerId } = req.params;
    
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No proof image uploaded'
      });
    }
    
    // multer provides req.file
    const { buffer, mimetype, originalname } = req.file;
    
    const winner = await WinnerService.uploadProof(userId, winnerId, buffer, mimetype, originalname);
    
    res.status(200).json({
      status: 'success',
      data: winner
    });
  } catch (error) {
    next(error);
  }
};
