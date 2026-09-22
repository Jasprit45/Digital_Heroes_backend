/**
 * draw.validation.js
 *
 * Zod schemas for draw-related request validation.
 */

'use strict';

const { z } = require('zod');

/**
 * Validates 'YYYY-MM' month format (e.g. '2026-09').
 */
const isValidYearMonth = (val) => /^\d{4}-(0[1-9]|1[0-2])$/.test(val);

/**
 * Schema for POST /api/v1/admin/draws/simulate
 */
const simulateDrawSchema = z.object({
  body: z.object({
    month: z
      .string({ required_error: 'month is required' })
      .refine(isValidYearMonth, {
        message: 'month must be a valid calendar month in YYYY-MM format (e.g. 2026-09)',
      }),
    type: z.enum(['RANDOM', 'ALGORITHMIC'], {
      required_error: 'type is required',
      invalid_type_error: "type must be either 'RANDOM' or 'ALGORITHMIC'",
    }),
  }),
});

/**
 * Schema for routes with a draw ID path parameter.
 */
const drawIdParamSchema = z.object({
  params: z.object({
    id: z.string().uuid('Draw ID must be a valid UUID'),
  }),
});

module.exports = {
  simulateDrawSchema,
  drawIdParamSchema,
};
