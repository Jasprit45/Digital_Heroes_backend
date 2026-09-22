const adminUsersService = require('./adminUsers.service');

exports.listUsers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const { search, role, status } = req.query;
    
    const data = await adminUsersService.listUsers({ page, limit, search, role, status });
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};

exports.getUser = async (req, res, next) => {
  try {
    const data = await adminUsersService.getUser(req.params.id);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};

exports.updateUser = async (req, res, next) => {
  try {
    const data = await adminUsersService.updateUser(req.params.id, req.body);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};

exports.updateSubscription = async (req, res, next) => {
  try {
    const data = await adminUsersService.updateSubscription(req.params.id, req.body);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};

exports.updateScore = async (req, res, next) => {
  try {
    const { id, scoreId } = req.params;
    const data = await adminUsersService.updateScore(id, scoreId, req.body);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};
