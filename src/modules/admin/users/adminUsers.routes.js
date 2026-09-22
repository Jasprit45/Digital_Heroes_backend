const express = require('express');
const adminUsersController = require('./adminUsers.controller');

const router = express.Router();

router.get('/', adminUsersController.listUsers);
router.get('/:id', adminUsersController.getUser);
router.patch('/:id', adminUsersController.updateUser);
router.patch('/:id/subscription', adminUsersController.updateSubscription);
router.patch('/:id/scores/:scoreId', adminUsersController.updateScore);

module.exports = router;
