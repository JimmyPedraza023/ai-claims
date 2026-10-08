import { Injectable } from '@nestjs/common';
import type { Queryable } from '../../database/queryable.js';

export interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
}

const COLS = `
  id,
  email,
  full_name AS "fullName",
  password_hash AS "passwordHash",
  role,
  is_active AS "isActive"
`;

@Injectable()
export class UsersRepository {
  async findByEmail(
    c: Queryable,
    email: string,
  ): Promise<UserRecord | null> {
    const { rows } = await c.query<UserRecord>(
      `SELECT ${COLS} FROM users WHERE email = $1`,
      [email],
    );

    return rows[0] ?? null;
  }

  async findById(
    c: Queryable,
    id: string,
  ): Promise<UserRecord | null> {
    const { rows } = await c.query<UserRecord>(
      `SELECT ${COLS} FROM users WHERE id = $1`,
      [id],
    );

    return rows[0] ?? null;
  }

  async touchLogin(c: Queryable, id: string): Promise<void> {
    await c.query(
      'UPDATE users SET last_login_at = now() WHERE id = $1',
      [id],
    );
  }
}