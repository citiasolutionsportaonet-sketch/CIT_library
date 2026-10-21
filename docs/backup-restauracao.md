# Backup e restauração

## Backup
```bash
npm run backup
```
1. Toma o lock exclusivo de escrita no PostgreSQL (espera transações em curso; novas escritas recebem 503 "em manutenção").
2. `pg_dump -Fc` dentro do container.
3. Copia `MEDIA_ROOT` (sem temporários) calculando SHA-256 de cada arquivo.
4. Libera o lock e grava `manifest.json` (versão/commit, migrações, versão do PostgreSQL, tenants, contagens, hashes, tempo de bloqueio).
Resultado: `BACKUP_ROOT/cit-backup-AAAAMMDD-HHMMSSZ/`. Falha no meio remove a pasta parcial e não toca backups anteriores.

O backup contém dados pessoais, hashes de senha e sessões. Guarde em disco criptografado (FileVault / disco externo criptografado) e com acesso restrito. **O `.env` não entra no backup**: guarde uma cópia protegida separada.

## Restauração (sempre em destino novo)
```bash
npm run restore -- --manifest var/backups/cit-backup-XXXX/manifest.json --target cit_restore_teste
```
Valida tamanho e hash de todos os arquivos e recusa caminhos inseguros antes de criar qualquer coisa; recusa banco existente ou diretório de mídia não vazio; restaura, **apaga as sessões copiadas**, confere contagens e arquivos e aplica grants. Para abrir o app sobre a cópia, use um `.env` separado apontando `DATABASE_URL` para o banco novo e `MEDIA_ROOT` para a mídia restaurada.

## Política proposta (ainda manual)
- Backup diário, antes de migrações e antes de trocar de servidor.
- Reter 7 diários e 4 semanais; nunca apagar o último válido. **Rotação automática ainda não implementada.**
- 3-2-1: cópia fora do Mac servidor e uma cópia desconectada. Backup na mesma unidade é só cópia operacional.
- Teste mensal de restauração, registrando duração em docs/validacao.md. Metas RPO 24 h / RTO 4 h **não medidas ainda**.
- Agendamento por launchd: pendente.
