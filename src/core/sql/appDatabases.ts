// DB App của dự án — làm giống FSD Studio 5.1 / 5.2 (ProjectService.AppDatabasesAsync, clsDatabase.vb):
// chạy script GETLISTDATAAPP trên DB Sys (SELECT RTRIM(cdata) AS val FROM entity ORDER BY code); bảng cũ không có cột cdata
// thì thử lại với "data". DB App mặc định = dòng đầu. Không đoán tên DB.
import type { SqlClient } from './sqlClient';

/** Tên DB từ các dòng kết quả (cột đầu), bỏ rỗng và trùng (không phân biệt hoa thường), giữ thứ tự. */
export function parseAppDatabases(rows: Array<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const first = Object.values(r)[0];
    const name = first === null || first === undefined ? '' : String(first).trim();
    if (name !== '' && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

export async function loadAppDatabases(client: Pick<SqlClient, 'query'>, script: string): Promise<string[]> {
  const sql = script.replace(/^﻿/, '').trim();
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await client.query(sql);
  } catch {
    // 5.1: bảng entity bản cũ đặt tên cột là data
    rows = await client.query(sql.replace('cdata', 'data'));
  }
  return parseAppDatabases(rows);
}

/** Tên DB an toàn để đặt trong [ ] của câu SELECT chạy trên DB Sys (vd [db].sys.objects). */
export function bracketName(name: string): string {
  return '[' + name.replace(/]/g, ']]') + ']';
}

/** Tên bảng / view đưa vào SELECT TOP 100: chỉ bỏ ngoặc khi là tên thường (chữ, số, _ $ # @). */
export function quoteTable(schema: string, name: string): string {
  const plain = (s: string): boolean => /^[A-Za-z_][\w$#@]*$/.test(s);
  const n = plain(name) ? name : bracketName(name);
  if (!schema || schema.toLowerCase() === 'dbo') return n;
  return (plain(schema) ? schema : bracketName(schema)) + '.' + n;
}

/** SELECT liệt kê bảng + view người dùng của một DB, chạy trên kết nối Sys (SELECT-only, ba phần tên). */
export function listTablesSql(database: string): string {
  return (
    `SELECT RTRIM(o.name) AS name, RTRIM(o.type) AS type, SCHEMA_NAME(o.schema_id) AS [schema] ` +
    `FROM ${bracketName(database)}.sys.objects o WHERE o.type IN ('U','V') AND o.is_ms_shipped = 0 ORDER BY o.name`
  );
}
