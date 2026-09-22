const analyticsService = require('./analytics.service');

exports.getAnalytics = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const data = await analyticsService.getAnalytics(from, to);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};
