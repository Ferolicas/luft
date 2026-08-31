import { Role } from '../generated/identity/enums';

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  fullName: string;
  stratum: number;
  role: Role;
  status: string;
}
