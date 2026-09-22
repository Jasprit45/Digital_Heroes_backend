const WinnerService = require('./winner.service');

exports.getAdminWinners = async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      draw_month: req.query.draw_month,
      tier: req.query.tier
    };
    
    const winners = await WinnerService.getAdminWinners(filters);
    
    res.json({
      status: 'success',
      data: winners
    });
  } catch (error) {
    next(error);
  }
};

exports.verifyWinner = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const { id: winnerId } = req.params;
    const { action, rejection_reason } = req.body;
    
    const winner = await WinnerService.verifyWinner(adminId, winnerId, action, rejection_reason);
    
    res.status(200).json({
      status: 'success',
      data: winner
    });
  } catch (error) {
    next(error);
  }
};

exports.payWinner = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const { id: winnerId } = req.params;
    
    const winner = await WinnerService.payWinner(adminId, winnerId);
    
    res.status(200).json({
      status: 'success',
      data: winner
    });
  } catch (error) {
    next(error);
  }
};

exports.generateProofUrl = async (req, res, next) => {
  try {
    const { id: winnerId } = req.params;
    
    const data = await WinnerService.generateProofUrl(winnerId);
    
    res.status(200).json({
      status: 'success',
      data
    });
  } catch (error) {
    next(error);
  }
};
