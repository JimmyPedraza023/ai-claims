// modules/auth/jwt-auth.guard.ts

import { SetMetadata } from "@nestjs/common/decorators/core/index.js";
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { UsersRepository } from "./users.repository";
import { DatabaseService } from "../../database/database.service.js";

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
export interface AuthUser { id: string; fullName: string; role: string }

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
    private readonly users: UsersRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException();

    let sub: string;
    try { ({ sub } = await this.jwt.verifyAsync<{ sub: string }>(token, { algorithms: ['HS256'] })); }
    catch { throw new UnauthorizedException(); }

    const user = await this.users.findById(this.db, sub);
    if (!user?.isActive) throw new UnauthorizedException();

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles && !roles.includes(user.role)) throw new ForbiddenException();

    req.user = { id: user.id, fullName: user.fullName, role: user.role };
    return true;
  }
}