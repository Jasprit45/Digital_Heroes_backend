const scoreService = require('./score.service');

class ScoreController {
  /**
   * GET /api/v1/user/scores
   */
  async getScores(req, res, next) {
    try {
      const userId = req.user.id;
      const scores = await scoreService.getUserScores(userId);

      res.status(200).json({
        success: true,
        data: scores,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/user/scores
   */
  async addScore(req, res, next) {
    try {
      const userId = req.user.id;
      const scores = await scoreService.addScore(userId, req.body);

      res.status(201).json({
        success: true,
        message: 'Score added successfully.',
        data: scores,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/user/scores/:id
   */
  async updateScore(req, res, next) {
    try {
      const userId = req.user.id;
      const scoreId = req.params.id;
      const updatedScore = await scoreService.updateScore(userId, scoreId, req.body);

      res.status(200).json({
        success: true,
        message: 'Score updated successfully.',
        data: updatedScore,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/user/scores/:id
   */
  async deleteScore(req, res, next) {
    try {
      const userId = req.user.id;
      const scoreId = req.params.id;
      const result = await scoreService.deleteScore(userId, scoreId);

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ScoreController();
