/**
 * draw.controller.js
 *
 * HTTP layer for admin draw endpoints.
 * Delegates all business logic to drawService.
 */

'use strict';

const drawService = require('./draw.service');

class DrawController {
  /**
   * POST /api/v1/admin/draws/simulate
   */
  async simulate(req, res, next) {
    try {
      const adminUserId = req.user.id;
      const { month, type } = req.body;

      const simulationResult = await drawService.simulateDraw(adminUserId, { month, type });

      res.status(200).json({
        success: true,
        message: `Draw simulation for ${month} completed successfully. Review the result before publishing.`,
        data: simulationResult,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/draws/simulation/:id
   */
  async getSimulation(req, res, next) {
    try {
      const simulation = await drawService.getSimulationById(req.params.id);
      res.status(200).json({
        success: true,
        data: simulation,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/draws/:id/publish
   */
  async publish(req, res, next) {
    try {
      const adminUserId = req.user.id;
      const drawId = req.params.id;

      const publishedResult = await drawService.publishDraw(adminUserId, drawId);

      res.status(200).json({
        success: true,
        message: `Draw for ${publishedResult.month} has been published successfully. Official winner records created.`,
        data: publishedResult,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/user/draws/my-history
   */
  async getMyHistory(req, res, next) {
    try {
      const userId = req.user.id;
      const history = await drawService.getUserDrawHistory(userId);

      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/public/draws/published/latest
   */
  async getLatestPublished(req, res, next) {
    try {
      const draw = await drawService.getLatestPublishedDraw();

      if (!draw) {
        return res.status(200).json({
          success: true,
          message: 'No published draw found.',
          data: null,
        });
      }

      res.status(200).json({
        success: true,
        data: draw,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DrawController();
