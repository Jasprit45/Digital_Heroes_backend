const express = require('express');
const adminCharitiesController = require('./adminCharities.controller');

const router = express.Router();

router.get('/', adminCharitiesController.listCharities);
router.post('/', adminCharitiesController.createCharity);
router.put('/:id', adminCharitiesController.updateCharity);
router.delete('/:id', adminCharitiesController.deleteCharity);

module.exports = router;
