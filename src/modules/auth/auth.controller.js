const authService = require('./auth.service');

const COOKIE_NAME = 'refreshToken';

const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    path: '/',
  };
};

class AuthController {
  /**
   * Register new user
   */
  async register(req, res, next) {
    try {
      const user = await authService.register(req.body);
      
      res.status(201).json({
        success: true,
        message: 'Registration successful.',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Login user
   */
  async login(req, res, next) {
    try {
      const { user, accessToken, rawRefreshToken } = await authService.login(req.body);

      // Set raw refresh token in HttpOnly cookie
      res.cookie(COOKIE_NAME, rawRefreshToken, getCookieOptions());

      res.status(200).json({
        success: true,
        message: 'Login successful.',
        data: {
          accessToken,
          user,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Rotate refresh token and issue new access token
   */
  async refreshToken(req, res, next) {
    try {
      const rawRefreshToken = req.cookies[COOKIE_NAME];
      const { user, accessToken, rawRefreshToken: newRawRefreshToken } = await authService.refreshToken(rawRefreshToken);

      // Set new raw refresh token in HttpOnly cookie
      res.cookie(COOKIE_NAME, newRawRefreshToken, getCookieOptions());

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully.',
        data: {
          accessToken,
          user,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Logout user and revoke refresh token
   */
  async logout(req, res, next) {
    try {
      const rawRefreshToken = req.cookies[COOKIE_NAME];
      await authService.logout(rawRefreshToken);

      // Clear cookie
      const isProduction = process.env.NODE_ENV === 'production';
      res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/',
      });

      res.status(200).json({
        success: true,
        message: 'Logged out successfully.',
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
