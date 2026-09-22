const { z } = require('zod');

const createCheckoutSessionSchema = z.object({
  body: z.object({
    plan: z.enum(['MONTHLY', 'YEARLY'], {
      required_error: 'Plan is required (MONTHLY or YEARLY)',
      invalid_type_error: 'Plan must be either MONTHLY or YEARLY',
    }),
    selected_charity_id: z
      .string()
      .uuid('Invalid charity ID format (must be a valid UUID)')
      .optional()
      .nullable(),
    charity_percentage: z
      .number({ required_error: 'Charity percentage is required' })
      .min(10, 'Minimum charity contribution percentage is 10%')
      .max(100, 'Maximum charity contribution percentage is 100%'),
  }),
});

module.exports = {
  createCheckoutSessionSchema,
};
