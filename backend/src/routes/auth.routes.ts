import { Router } from 'express';
import {
  validateRegister,
  validateLogin,
  registerHandler,
  loginHandler,
  logoutHandler,
  meHandler,
} from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';
import {
  validateUpdateProfile,
  validateChangePassword,
  updateProfileHandler,
  changePasswordHandler,
} from '../controllers/profile.controller';

const router = Router();

router.post('/register', validateRegister, registerHandler);
router.post('/login', validateLogin, loginHandler);
router.post('/logout', logoutHandler);
router.get('/me', requireAuth, meHandler);
router.put('/profile', requireAuth, validateUpdateProfile, updateProfileHandler);
router.post('/change-password', requireAuth, validateChangePassword, changePasswordHandler);

export default router;
