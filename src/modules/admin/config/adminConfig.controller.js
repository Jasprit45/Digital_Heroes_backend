const adminConfigService = require('./adminConfig.service');

exports.getPrizePoolConfig = async (req, res, next) => {
  try {
    const data = await adminConfigService.getPrizePoolConfig();
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};

exports.updatePrizePoolConfig = async (req, res, next) => {
  try {
    const data = await adminConfigService.updatePrizePoolConfig(req.body);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};
