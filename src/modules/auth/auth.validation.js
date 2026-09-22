const { z } = require('zod');

const registerSchema = z.object({
  body: z.object({
    full_name: z
      .string({ required_error: 'Full name is required' })
      .trim()
      .min(2, 'Full name must be at least 2 characters long')
      .max(100, 'Full name cannot exceed 100 characters'),
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .email('Invalid email address format')
      .toLowerCase(),
    password: z
      .string({ required_error: 'Password is required' })
      .min(8, 'Password must be at least 8 characters long')
      .max(100, 'Password cannot exceed 100 characters'),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .email('Invalid email address format')
      .toLowerCase(),
    password: z
      .string({ required_error: 'Password is required' }),
  }),
});

module.exports = {
  registerSchema,
  loginSchema,
};
