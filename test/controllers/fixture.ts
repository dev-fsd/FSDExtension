// Dựng thư mục Controllers giả trong os.tmpdir() cho test (không dùng khóa / dữ liệu thật).
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FControllerCrypto } from '../../src/core/controllers/fCrypto';

export interface Fixture {
  root: string;
  controllers: string;
  key: Uint8Array;
  iv: Uint8Array;
  crypto: FControllerCrypto;
  cleanup: () => void;
}

export function writeFile(file: string, content: string | Buffer, mtimeSec?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (typeof content === 'string') fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf8')]));
  else fs.writeFileSync(file, content);
  if (mtimeSec !== undefined) fs.utimesSync(file, mtimeSec, mtimeSec);
}

/** Bộ controller giả: sysId GLTran (có Grid con, Lookup, showForm, Import, Report, Include), OnlyF, Cu. */
export function buildFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsdmenu-'));
  const controllers = path.join(root, 'App_Data', 'Controllers') + path.sep;
  const key = new Uint8Array(crypto.randomBytes(16));
  const iv = new Uint8Array(crypto.randomBytes(16));
  const c = (...p: string[]): string => path.join(controllers, ...p);

  const dirDoc = (command: string): string => `<!DOCTYPE dir [ <!ENTITY TransferID "GLImp"> <!ENTITY Cmd SYSTEM "..\Include\Command\Common.ent"> ]>
<dir table="GLTran">
  <field><items style="Grid" controller="GLTranDetail"/></field>
  <field><items style="AutoComplete" controller="LkAcc"/></field>
  <field><items style="Grid" controller="GLTranThieu"/></field>
  ${command}
  <script>showForm('GLTranPrint'); show$Form(g, 'GLTranKhongCo'); exec the thing</script>
</dir>`;
  writeFile(
    c('Dir', 'GLTran.xml'),
    dirDoc('<command>exec zc_GLTran_Xml @a=1; exec FastBusiness$App$Voucher$Insert; exec &amp;Cmd; exec @proc; execute dbo.zc_Khac</command>'),
    1000
  );
  // .f cũ hơn .xml → staleF; command nằm trong vùng mã hóa.
  writeFile(c('Dir', 'GLTran.f'), dirDoc(`<Encrypted>${FControllerCrypto.encode('<command>exec zc_bi_mat @x=1; execute dbo.zc_Khac</command>', key, iv)}</Encrypted>`), 500);
  writeFile(c('Grid', 'GLTran.xml'), `<grid table="GLTranList"><command>exec zc_list_ds</command></grid>`, 600);
  writeFile(c('Grid', 'GLTranDetail.f'), `<grid table="GLTranD"><command>exec zc_detail_ds</command></grid>`, 600);
  writeFile(c('Lookup', 'LkAcc.xml'), `<lookup/>`);
  writeFile(c('Filter', 'GLTran.xml'), `<filter/>`);
  writeFile(c('Filter', 'GLTranPrint.xml'), `<filter/>`);
  writeFile(c('Filter', 'GLImpImport.xml'), `<filter/>`);
  writeFile(c('Templates', 'Upload', 'GLImp.xml'), `<upload/>`);
  writeFile(c('Templates', 'Excel', 'GLImp.xlsx'), Buffer.from('PK'));
  writeFile(
    c('Report', 'GLTran.xml'),
    `<report><reportFile value="Rep1.rpt"/><templateFile value="Mau1"/><command>exec rs_GLTran_in</command></report>`
  );
  writeFile(c('Templates', 'Frx', 'Rep1.frx'), `<frx/>`);
  writeFile(c('Templates', 'Rpt', 'Rep1.rpt'), Buffer.from('rpt'));
  writeFile(c('Templates', 'Excel', 'Mau1.xlsx'), Buffer.from('PK'));
  writeFile(c('Include', 'Command', 'Revert.GLTran.ent'), `<x/>`);
  writeFile(c('Include', 'Javascript', 'Extender.Include.GLTran'), `x`);
  writeFile(c('Include', 'Command', 'Common.ent'), `<x/>`);
  writeFile(c('Include', 'Javascript', 'GLTran.txt'), `x`);
  writeFile(c('Include', 'XML', 'GLTran.xml'), `<x/>`);
  writeFile(c('Include', 'Command', 'Extender.GLTran'), `x`);
  writeFile(c('Include', 'Command', 'MultiPrint.Grid.Queries.GLTran'), `x`);
  writeFile(c('Include', 'Command', 'Tiny.External.GLTran'), `x`);
  writeFile(c('Include', 'Command', 'Revert.GLTranOther.ent'), `<x/>`);

  // sysId chỉ có .f, không mã hóa
  writeFile(c('Dir', 'OnlyF.f'), `<dir table="OnlyF"><command>exec zc_onlyf</command></dir>`);
  // sysId không có file nào (Dir/Grid/Filter/Report đều thiếu)
  fs.mkdirSync(c('Dir'), { recursive: true });

  return { root, controllers, key, iv, crypto: new FControllerCrypto([{ key, iv }]), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
