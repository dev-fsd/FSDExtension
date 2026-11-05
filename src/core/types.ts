// Hợp đồng chung giữa các phần của extension FSD Menu (docs/extension/code-plan.md mục 3).
// Agent không sửa file này; thiếu kiểu thì ghi vào báo cáo để người ráp bổ sung.
// Chỉ FBO (wcommand) và Mobile (dvcommand) — không làm FB (command).

/** Loại menu: FBO = wcommand, Mobile = dvcommand. */
export type MenuKind = 'fbo' | 'mob';

/** Một dự án trong dmda (config.db của FSD Studio), không có mật khẩu. */
export interface ProjectRecord {
  /** dmda.ma_da (đã trim, giữ hoa thường như gốc). */
  code: string;
  name: string;
  /** dmda.ma_td2: '2' = FBO; rỗng coi là '2'. */
  menuType: string;
  /** dmda.server, có thể kèm "; Connect Timeout = …", dạng host, host\instance hoặc host,port. */
  server: string;
  /** dmda.username (SQL login; mọi dự án hiện dùng mode = 1). */
  user: string;
  /** dmda.mode: '0' = Windows auth (bản 1 không hỗ trợ), '1' = SQL login. */
  mode: string;
  sysDatabase: string;
  /** Thư mục web nguồn (dmda.web_source), có "\" cuối; rỗng thì dùng webProgramDir. */
  webSource: string;
  webProgramDir: string;
  /** dmda.web_host01 / QLYC web_host1: địa chỉ web host 1, 2 (mở trang menu). Rỗng = chưa khai. */
  webHost1: string;
  webHost2: string;
  /** dmda.mobile_dir thô: rỗng = thư mục "MobileApp" cạnh thư mục web; tên = thư mục cạnh web; đường dẫn đủ = dùng luôn. */
  mobileDir: string;
  /** dmda.status (còn sử dụng). */
  active: boolean;
}

/** Dòng dmda đọc từ config.db, kèm mật khẩu còn mã hóa (Sys.EncodeText key 13). */
export interface DmdaRow extends ProjectRecord {
  passwordEncoded: string;
}

/** Kết quả khớp file đang mở với dự án. */
export interface ProjectMatch {
  project: ProjectRecord;
  /** 'web' = dưới thư mục web; 'mobile' = dưới thư mục Mobile. */
  area: 'web' | 'mobile';
  /** Gốc đã khớp (thư mục web hoặc Mobile), có "\" cuối. */
  root: string;
  /** Thư mục Controllers tương ứng, có "\" cuối: web = <root>App_Data\Controllers\, mobile = <root>App_Data\Controllers\Mobile\. */
  controllersDir: string;
}

/** Một dòng menu (wcommand / dvcommand). */
export interface MenuItem {
  kind: MenuKind;
  /** wmenu_id */
  id: string;
  /** wmenu_id0 (cha) */
  parentId: string;
  /** Tên hiển thị (bar). */
  bar: string;
  sysId: string;
  /** wcommand.link (Mobile: rỗng). */
  link: string;
  /** wcommand.type / dvcommand.xtype: V chứng từ, D danh mục, R báo cáo… */
  type: string;
  /** Chỉ Mobile. */
  mobile?: {
    fboMenuId: string;
    iconUrl: string;
    iconColor: string;
    /** dvcommand.status: true = đang bật. */
    enabled: boolean;
    xgroup: string;
    action: string;
    bar2: string;
  };
}

export interface MenuNode extends MenuItem {
  children?: MenuNode[];
}

/** Vai trò của file trong một menu. */
export type MenuFileRole = 'dir' | 'grid' | 'filter' | 'report' | 'dashboard' | 'lookup' | 'import' | 'template' | 'include';

/** Một controller / file thuộc menu, dò theo sysid (docs/v5.2/ba-ui.md mục 7). */
export interface MenuFile {
  /** Đường dẫn đầy đủ để mở: .xml nếu có, không thì .f (controller chỉ có .f) hoặc file mẫu. Thiếu file = đường dẫn dự kiến (.xml). */
  path: string;
  role: MenuFileRole;
  /** Tên tương đối dưới Controllers, không đuôi với controller (vd "Grid\GLTranDetail"), có đuôi với file mẫu. */
  name: string;
  /** Lý do vào danh sách. */
  via: 'root' | 'grid' | 'lookup' | 'showForm' | 'import' | 'reportFile' | 'templateFile' | 'include';
  hasF: boolean;
  hasXml: boolean;
  /** Ngày sửa (ms) — có file nào thì có giá trị đó. */
  fMtime?: number;
  xmlMtime?: number;
  /** Có cả .f và .xml, .f cũ hơn .xml (chưa sinh lại). */
  staleF: boolean;
  /** Được khai báo (showForm, items controller…) nhưng không có file. */
  missing: boolean;
}

export interface MenuStructureResult {
  sysId: string;
  controllersDir: string;
  files: MenuFile[];
  /** Bảng ở <dir table> / <grid table> (bỏ giá trị entity / biến / bảng kỳ). */
  tables: string[];
  /** Store gọi bằng exec trong file của menu (không lấy từ Include dùng chung). */
  stores: string[];
  /** Controller có .f nhưng giải không trọn nên đã đọc .xml. */
  fellBack: string[];
}

/** Nội dung controller đã đọc (vùng mã hóa giải trong bộ nhớ; không hiển thị, không ghi ra file). */
export interface ControllerText {
  path: string;
  source: 'f' | 'xml';
  text: string;
  lockedRegions: number;
  decodedRegions: number;
  fellBackFromF: boolean;
}

/** Cặp key / IV đọc từ file khóa (mỗi dòng key_hex|iv_hex). */
export interface KeyPair {
  key: Uint8Array;
  iv: Uint8Array;
}

/** Một menu dùng tới một file (chỉ mục ngược). */
export interface MenuRef {
  kind: MenuKind;
  menuId: string;
  sysId: string;
  bar: string;
}

/** Hủy tác vụ dài (tương thích vscode.CancellationToken mà không import vscode). */
export interface CancelToken {
  readonly isCancellationRequested: boolean;
}
