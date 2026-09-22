const adminCharitiesService = require('./adminCharities.service');

exports.listCharities = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    
    const data = await adminCharitiesService.listCharities({ page, limit });
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};

exports.createCharity = async (req, res, next) => {
  try {
    const data = await adminCharitiesService.createCharity(req.body);
    res.status(201).json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};

exports.updateCharity = async (req, res, next) => {
  try {
    const data = await adminCharitiesService.updateCharity(req.params.id, req.body);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};

exports.deleteCharity = async (req, res, next) => {
  try {
    const data = await adminCharitiesService.softDeleteCharity(req.params.id);
    res.json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};
