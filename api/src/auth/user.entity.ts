import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Mapea la tabla `users` de Liquibase (changeset 0004): coordinadores del panel. Solo se guarda el hash. */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  email: string;

  @Column('text')
  password_hash: string;

  @Column('text')
  role: string;
}
