/* ============================================================================
   OPS PERFORMANCE HUB — Google Apps Script Backend v3 (FASE 3 — REKONSILIASI)
   + MODUL KONVERSI RAW SIAP (baru)
   ----------------------------------------------------------------------------
   Menambahkan ke v2:
   E. REKONSILIASI : screening otomatis Kategori & Sebab, draft, commit,
                      status Final per bulan, tabel semua downtime
   F. KONVERSI RAW SIAP : jembatan dari format export SIAP asli (kode kategori
                      pendek: TL, TS, FL...) ke struktur SIAP_DOWNTIME, via
                      sheet bantu RAW_SIAP_IMPORT + tabel mapping MD_KODE_KATEGORI
   ============================================================================ */

/* ====== 1. KONFIGURASI — WAJIB DIISI ====== */
const CFG = {
  UID: 'opsintel',
  PASSWORD: 'GANTI_PASSWORD_KUAT_DISINI',   // ganti, samakan di dashboard

  // Nama tab di spreadsheet (biarkan default kecuali perlu ubah)
  SHEET_SIAP_DT:   'SIAP_DOWNTIME',    // raw downtime hasil upload (gabungan 3 PU)
  SHEET_SIAP_HP:   'SIAP_HASILPROD',   // raw hasil produksi
  SHEET_SIAP_NETOP:'SIAP_NETOP',       // raw net op
  SHEET_SIAP_PMK:  'SIAP_PEMAKAIAN',   // raw pemakaian (BOM)
  SHEET_UPLOAD_LOG:'UPLOAD_LOG',       // log upload buat deteksi dobel

  SHEET_PIC:    'MD_PIC',
  SHEET_TOL:    'MD_TOLERANSI',
  SHEET_KLAS:   'MD_KLASIFIKASI',
  SHEET_MESIN:  'MD_MESIN',            // master mesin + tipe + include flag
  SHEET_KAP:    'MD_KAPASITAS',
  SHEET_TARGET: 'MD_TARGET',
  SHEET_ACTION: 'ACTION_TRACKING',

  // ===== Fase 3 — Rekonsiliasi =====
  SHEET_KOREKSI:   'REKONSILIASI_KOREKSI',   // draft + histori koreksi Kategori/Sebab per baris
  SHEET_STATUS:    'UPLOAD_STATUS',          // status Final per PU+Bulan+Tahun
  SHEET_RULE_KAT:  'REKON_ATURAN_KATEGORI',  // aturan kata kunci -> kategori disarankan
  SHEET_RULE_SEBAB:'REKON_ATURAN_SEBAB',     // aturan kata kunci -> sebab disarankan
  SHEET_REKON_LOG: 'REKONSILIASI_LOG',       // audit trail commit (siapa, kapan, berapa baris)

  // ===== Fase 4 — User/Role, Audit, Backup, Undo, Rate Limit =====
  SHEET_USERS:     'USER_ACCOUNTS',      // uid, password, role, nama, aktif
  SHEET_LOGIN_LOG: 'LOGIN_LOG',          // audit: siapa login/akses kapan
  SHEET_ACTIVITY:  'ACTIVITY_LOG',       // audit: semua kirim/tarik data ke Sheets (lihat dari dashboard)
  SHEET_BACKUP:    'BACKUP_SNAPSHOT',    // cadangan ringkasan sebelum replace data bulanan
  SHEET_MASTER_HIST: 'MASTER_HISTORY',   // riwayat versi Master Data (untuk fitur Undo)
  SHEET_RATE_LIMIT:  'RATE_LIMIT_LOG',   // pencatatan waktu request per UID (rate limiting sederhana)
  SHEET_ACTIVE_SESSION: 'ACTIVE_SESSION',// siapa sedang membuka modul apa (notifikasi lintas-user)

  // ===== BARU — Konversi Raw SIAP =====
  SHEET_RAW_IMPORT:    'RAW_SIAP_IMPORT',    // tempat paste data mentah SIAP apa adanya
  SHEET_KODE_KATEGORI: 'MD_KODE_KATEGORI',   // kode pendek (TL/TS/FL) -> nama Kategori resmi
  SHEET_KONVERSI_LOG:  'KONVERSI_RAW_LOG',   // log tiap konversi (berapa baris masuk/keluar, kode tak dikenal)

  // ===== BARU — 4 Sheet Raw Bulanan (paste manual, header PERSIS struktur SIAP asli + kolom PU) =====
  SHEET_RAW_HP:    'RAW_BULANAN_HASILPROD',  // paste manual sheet "Hasil Produksi" SIAP
  SHEET_RAW_DT:    'RAW_BULANAN_DOWNTIME',   // paste manual sheet "Downtime" SIAP
  SHEET_RAW_PMK:   'RAW_BULANAN_PEMAKAIAN',  // paste manual sheet "Pemakaian" SIAP
  SHEET_RAW_NETOP: 'RAW_BULANAN_NETOP',      // paste manual sheet "Net Op" SIAP

  // ===== BARU — Mitigasi / Action Tracking (terpisah dari ACTION_TRACKING lama yg cuma note per Fungsi) =====
  SHEET_MITIGASI:      'MITIGASI_ACTION',    // daftar action item mitigasi downtime
  SHEET_MITIGASI_LOG:  'MITIGASI_LOG',       // histori perubahan status tiap action
  DRIVE_FOLDER_EVIDENCE: 'OPS_HUB_Evidence_Mitigasi', // nama folder Drive tempat file evidence disimpan

  // ===== BARU — Cost of Downtime dalam Rupiah =====
  SHEET_COST: 'MD_COST_PARAM', // parameter biaya per PU: Rp/jam produksi & Rp/KL, dipakai kalikan downtime -> Rupiah
};

/* ====== 2. ENTRY POINTS ====== */
function doGet(e){
  try{
    if(!auth_(e)) return json_({ok:false, error:'AUTH_FAILED'});
    const p = (e && e.parameter) || {};
    logLogin_(p.uid);

    // Endpoint khusus rekonsiliasi (selain payload utama)
    if(p.action === 'get_all_downtime')       return json_(handleGetAllDowntime_(p));
    if(p.action === 'get_screening')          return json_(handleGetScreening_(p));
    if(p.action === 'get_upload_status')      return json_(handleGetUploadStatus_(p));
    if(p.action === 'get_rekon_log')          return json_(handleGetRekonLog_(p));

    // ===== Fase 4 — User/Role, Audit, Sesi Aktif =====
    if(p.action === 'get_users')               return json_(handleGetUsers_(p));
    if(p.action === 'get_activity_log')        return json_(handleGetActivityLog_(p));
    if(p.action === 'get_login_log')           return json_(handleGetLoginLog_(p));
    if(p.action === 'get_master_history')      return json_(handleGetMasterHistory_(p));
    if(p.action === 'get_active_sessions')     return json_(handleGetActiveSessions_(p));

    // ===== BARU — Konversi Raw SIAP =====
    if(p.action === 'get_raw_import_status')   return json_(handleGetRawImportStatus_(p));
    if(p.action === 'get_kode_kategori')        return json_(handleGetKodeKategori_(p));

    // ===== BARU — Mitigasi / Action Tracking =====
    if(p.action === 'get_actions_mitigasi')     return json_(handleGetActionsMitigasi_(p));

    return json_({ok:true, data:buildPayload_(), ts:new Date().toISOString(), me:getUserInfo_(p.uid)});
  }catch(err){ return json_({ok:false, error:String(err), stack:err.stack}); }
}

function logLogin_(uid){
  if(!uid) return;
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(CFG.SHEET_LOGIN_LOG);
  if(!sh){ sh=ss.insertSheet(CFG.SHEET_LOGIN_LOG); sh.appendRow(['Waktu','UID']); }
  sh.appendRow([new Date().toISOString(), uid]);
}

function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents || '{}');
    if(!authBody_(body)) return json_({ok:false, error:'AUTH_FAILED'});

    // Rate limiting sederhana: maksimal 1 permintaan tulis per UID setiap 2 detik,
    // supaya klik ganda/berulang tidak memicu race condition di Google Sheets.
    const rl = checkRateLimit_(body.uid);
    if(!rl.ok) return json_({ok:false, error:'RATE_LIMITED', message:`Terlalu cepat mengirim permintaan. Tunggu ${rl.waitMs}ms lagi.`});

    // Routing berdasar 'action'
    let result;
    if(body.action === 'upload_siap')       result = handleUploadSIAP_(body);
    else if(body.action === 'save_master')       result = handleSaveMaster_(body);
    else if(body.action === 'check_dupe')        result = checkDupe_(body);

    // ===== Fase 3 — Rekonsiliasi =====
    else if(body.action === 'save_draft')        result = handleSaveDraft_(body);
    else if(body.action === 'discard_draft')     result = handleDiscardDraft_(body);
    else if(body.action === 'commit_koreksi')    result = handleCommitKoreksi_(body);
    else if(body.action === 'mark_final')        result = handleMarkFinal_(body);
    else if(body.action === 'unmark_final')      result = handleUnmarkFinal_(body);
    else if(body.action === 'save_rule')         result = handleSaveRule_(body);
    else if(body.action === 'delete_rule')       result = handleDeleteRule_(body);

    // ===== Fase 4 — User/Role, Undo, Sesi Aktif =====
    else if(body.action === 'create_user')       result = handleCreateUser_(body);
    else if(body.action === 'update_user')       result = handleUpdateUser_(body);
    else if(body.action === 'delete_user')       result = handleDeleteUser_(body);
    else if(body.action === 'undo_master')       result = handleUndoMaster_(body);
    else if(body.action === 'heartbeat_session') result = handleHeartbeatSession_(body);

    // ===== BARU — Konversi Raw SIAP =====
    else if(body.action === 'save_raw_import')   result = handleSaveRawImport_(body);
    else if(body.action === 'convert_raw_siap')  result = handleConvertRawSiap_(body);
    else if(body.action === 'save_kode_kategori') result = handleSaveKodeKategori_(body);
    else if(body.action === 'clear_raw_import')  result = handleClearRawImport_(body);
    else if(body.action === 'sync_raw_bulanan')  result = handleSyncRawBulanan_(body);

    // ===== BARU — Mitigasi / Action Tracking =====
    else if(body.action === 'create_action_mitigasi')   result = handleCreateActionMitigasi_(body);
    else if(body.action === 'update_action_mitigasi')   result = handleUpdateActionMitigasi_(body);
    else if(body.action === 'add_evidence_mitigasi')    result = handleAddEvidenceMitigasi_(body);

    // default: simpan section master (kompat lama)
    else if(body.kind){ saveSection_(body.kind, body.rows||[]); result = {ok:true, saved:body.kind, n:(body.rows||[]).length}; }
    else result = {ok:false, error:'UNKNOWN_ACTION'};

    logActivity_(body.uid, body.action||'save_section', result && result.ok, JSON.stringify(body).slice(0,300));
    return json_(result);
  }catch(err){
    try{ logActivity_((JSON.parse(e.postData.contents||'{}').uid)||'?', 'ERROR', false, String(err)); }catch(e2){}
    return json_({ok:false, error:String(err), stack:err.stack});
  }
}

/* Rate limiting: maksimal 1 request tulis per UID per 2 detik. Menggunakan
   CacheService (bukan Sheet) supaya cepat dan tidak menambah beban baca/tulis Sheet. */
function checkRateLimit_(uid){
  if(!uid) return {ok:true};
  const cache = CacheService.getScriptCache();
  const key = 'ratelimit_'+uid;
  const last = cache.get(key);
  const now = Date.now();
  if(last && (now-Number(last)) < 2000){
    return {ok:false, waitMs: 2000-(now-Number(last))};
  }
  cache.put(key, String(now), 10);
  return {ok:true};
}

/* Activity log: mencatat SETIAP operasi tulis (kirim data) ke Google Sheets, supaya
   admin dapat melihat riwayat lengkap langsung dari dashboard tanpa membuka Sheet. */
function logActivity_(uid, action, success, detail){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(CFG.SHEET_ACTIVITY);
  if(!sh){ sh=ss.insertSheet(CFG.SHEET_ACTIVITY); sh.appendRow(['Waktu','UID','Action','Berhasil','Detail']); }
  sh.appendRow([new Date().toISOString(), uid||'?', action, success?'YA':'TIDAK', String(detail||'').slice(0,300)]);
}

/* ====== 3. AUTH ====== */
/* ====== AUTH BERBASIS USER_ACCOUNTS (dengan fallback darurat ke CFG) ======
   Setiap request kini divalidasi terhadap sheet USER_ACCOUNTS (uid, password, role, nama, aktif).
   CFG.UID/CFG.PASSWORD dipertahankan sebagai fallback darurat -- hanya berfungsi jika
   sheet USER_ACCOUNTS kosong sama sekali (misalnya belum sempat setupSheets), supaya
   admin tetap bisa masuk untuk memperbaiki konfigurasi. */
function auth_(e){ const p=(e&&e.parameter)||{}; return authCheck_(p.uid, p.pw); }
function authBody_(b){ return b && authCheck_(b.uid, b.pw); }
function authCheck_(uid, pw){
  if(!uid || !pw) return false;
  const users = readSheet_(CFG.SHEET_USERS);
  if(!users.length){ return uid===CFG.UID && pw===CFG.PASSWORD; } // fallback darurat
  const u = users.find(r=>String(r.UID)===String(uid) && String(r.Password)===String(pw) && String(r.Aktif)!=='false' && r.Aktif!==false);
  return !!u;
}
function getUserInfo_(uid){
  const users = readSheet_(CFG.SHEET_USERS);
  const u = users.find(r=>String(r.UID)===String(uid));
  return u ? {uid:u.UID, nama:u.Nama, role:u.Role} : {uid:uid, nama:uid, role:'user'};
}
function isAdmin_(uid){
  const users = readSheet_(CFG.SHEET_USERS);
  const u = users.find(r=>String(r.UID)===String(uid));
  if(!u) return uid===CFG.UID; // fallback darurat: UID lama dianggap admin
  return String(u.Role)==='admin';
}
/* ====== 4. UPLOAD SIAP + DETEKSI DOBEL (per-minggu ATAU per-bulan) ====== */
/* Dashboard kirim: {action:'upload_siap', pu:'PUJ', bulan:1, tahun:2026,
                     mode:'minggu'|'bulan', minggu: 1..5 (kalau mode='minggu'),
                     downtime:[...], hasilProd:[...], netOp:[...], pemakaian:[...]} */
function handleUploadSIAP_(body){
  const pu=body.pu, bulan=body.bulan, tahun=body.tahun||2026;
  const mode = body.mode === 'minggu' ? 'minggu' : 'bulan';
  const minggu = mode==='minggu' ? Number(body.minggu||0) : null;
  if(!pu||!bulan) return {ok:false, error:'PU & bulan wajib'};
  if(mode==='minggu' && !minggu) return {ok:false, error:'Nomor minggu wajib untuk mode per-minggu'};

  // --- Kalau bulan ini sudah FINAL, tolak upload kecuali eksplisit unmark dulu ---
  const status = getUploadStatus_(pu, bulan, tahun);
  if(status && status.Status === 'Final' && !body.forceOverrideFinal){
    return {ok:false, error:`${pu} ${bulan}/${tahun} sudah ditandai FINAL. Batalkan status Final dulu (Unmark Final) sebelum upload ulang, agar tidak menimpa data yang sedang direkonsiliasi.`, isFinal:true};
  }

  // --- DETEKSI DOBEL UPLOAD (PU + bulan + tahun [+ minggu] sudah ada?) ---
  const log = readSheet_(CFG.SHEET_UPLOAD_LOG);
  const dupe = log.find(r=>String(r.PU)===String(pu) && String(r.Bulan)===String(bulan) && String(r.Tahun)===String(tahun)
                          && String(r.Mode||'bulan')===mode && String(r.Minggu||'')===String(minggu||''));
  if(dupe && !body.force){
    return {ok:false, dupe:true,
      error:`${pu} ${mode==='minggu'?'minggu '+minggu+' bulan':'bulan'} ${bulan}/${tahun} sudah pernah di-upload (${dupe.Tanggal}). Kirim ulang dengan force:true untuk replace.`};
  }

  // --- DETEKSI DOBEL BARIS (dalam payload) + generate RowKey unik ---
  // Normalisasi dulu: dashboard boleh kirim key lowercase (kategori, detail, dst),
  // di-map eksplisit ke nama kolom sheet (Kategori, Detail, dst) supaya tidak bergantung
  // pada disiplin casing di sisi frontend.
  const dtRows = (body.downtime||[]).map(normalizeDowntimeRow_);
  const seen={}, dupRows=[];
  dtRows.forEach((r,i)=>{
    const key=[r.Tgl,r.Line,r.Kategori,r.Downtime].join('|');
    if(seen[key]) dupRows.push(i); else seen[key]=true;
    // RowKey: identitas baris yang stabil walau data di-replace (dipakai rekonsiliasi)
    r.RowKey = buildRowKey_(pu, bulan, tahun, r);
  });

  // --- CATAT BACKUP SNAPSHOT sebelum data lama dihapus (untuk investigasi jika upload keliru) ---
  const jumlahBarisSebelum = readSheet_(CFG.SHEET_SIAP_DT).filter(r=>
    String(r.PU)===String(pu) && String(r.Bulan)===String(bulan) && String(r.Tahun)===String(tahun)).length;
  catatBackupSnapshot_(pu, bulan, tahun, jumlahBarisSebelum, body.uid, mode==='minggu'?`Replace minggu ${minggu}`:'Replace sebulan penuh');

  // --- HAPUS data lama (rentang tergantung mode), lalu tulis baru ---
  // skipDowntimeReplace: true dipakai saat SIAP_DOWNTIME sudah diisi lewat jalur
  // konversi raw (convert_raw_siap) dan payload ini hanya membawa hasilProd/netOp/
  // pemakaian -- tanpa flag ini, downtime yang baru saja dikonversi akan ikut
  // terhapus karena dtRows kosong.
  if(!body.skipDowntimeReplace){
    if(mode==='minggu'){
      replaceWeekData_(CFG.SHEET_SIAP_DT, pu, bulan, tahun, minggu, dtRows);
    }else{
      replaceMonthData_(CFG.SHEET_SIAP_DT, pu, bulan, tahun, dtRows);
    }
  }
  if(mode==='minggu'){
    replaceWeekData_(CFG.SHEET_SIAP_HP,    pu, bulan, tahun, minggu, body.hasilProd||[]);
    replaceWeekData_(CFG.SHEET_SIAP_NETOP, pu, bulan, tahun, minggu, body.netOp||[]);
    replaceWeekData_(CFG.SHEET_SIAP_PMK,   pu, bulan, tahun, minggu, body.pemakaian||[]);
  }else{
    replaceMonthData_(CFG.SHEET_SIAP_HP,    pu, bulan, tahun, body.hasilProd||[]);
    replaceMonthData_(CFG.SHEET_SIAP_NETOP, pu, bulan, tahun, body.netOp||[]);
    replaceMonthData_(CFG.SHEET_SIAP_PMK,   pu, bulan, tahun, body.pemakaian||[]);
  }

  // --- CATAT ke log ---
  logUpload_(pu, bulan, tahun, mode, minggu, dtRows.length, dupRows.length, !!dupe);

  // --- Cek koreksi lama yang jadi ORPHAN (RowKey tidak lagi ada di data baru) ---
  const orphanInfo = checkOrphanKoreksi_(pu, bulan, tahun);

  // --- Reset status jadi Draft (upload baru = perlu final ulang) kalau sebelumnya final ---
  setUploadStatus_(pu, bulan, tahun, 'Draft', '');

  return {ok:true, pu, bulan, tahun, mode, minggu,
    rows:{downtime:dtRows.length, hasilProd:(body.hasilProd||[]).length,
          netOp:(body.netOp||[]).length, pemakaian:(body.pemakaian||[]).length},
    dupRowsRemoved:dupRows.length, replaced:!!dupe,
    orphanKoreksi: orphanInfo.count, orphanDetail: orphanInfo.detail};
}

/* RowKey: ID unik & stabil per baris downtime. */
function buildRowKey_(pu, bulan, tahun, r){
  const raw = [pu, bulan, tahun, r.Tgl, r.Line, r.Kategori, r.Downtime, String(r.Detail||'').slice(0,40)].join('|');
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw)).slice(0,16);
}

/* Normalisasi 1 baris downtime dari payload dashboard (key lowercase/camelCase apapun)
   menjadi key PascalCase yang SAMA PERSIS dengan header SIAP_DOWNTIME. */
function normalizeDowntimeRow_(r){
  return {
    Mesin: r.Mesin!=null?r.Mesin:r.mesin,
    Kategori: r.Kategori!=null?r.Kategori:r.kategori,
    Fungsi: r.Fungsi!=null?r.Fungsi:r.fungsi,
    Sub: r.Sub!=null?r.Sub:r.sub,
    Downtime: r.Downtime!=null?r.Downtime:(r.downtime!=null?r.downtime:r.durasi),
    OpTime: r.OpTime!=null?r.OpTime:(r.optime!=null?r.optime:r.opTime),
    LossKL: r.LossKL!=null?r.LossKL:(r.losskl!=null?r.losskl:r.lossKL),
    Detail: r.Detail!=null?r.Detail:r.detail,
    Tgl: r.Tgl!=null?r.Tgl:r.tgl,
    Line: r.Line!=null?r.Line:r.line,
    Shift: r.Shift!=null?r.Shift:r.shift,
    DOW: r.DOW!=null?r.DOW:r.dow,
    Klasifikasi: r.Klasifikasi!=null?r.Klasifikasi:r.klasifikasi,
    Big6: r.Big6!=null?r.Big6:r.big6,
    Sebab: r.Sebab!=null?r.Sebab:r.sebab,
  };
}

/* Cek dobel TANPA upload (buat warning di dashboard sebelum kirim) */
function checkDupe_(body){
  const log=readSheet_(CFG.SHEET_UPLOAD_LOG);
  const mode = body.mode==='minggu' ? 'minggu' : 'bulan';
  const d=log.find(r=>String(r.PU)===String(body.pu)&&String(r.Bulan)===String(body.bulan)&&String(r.Tahun)===String(body.tahun||2026)
                      && String(r.Mode||'bulan')===mode && String(r.Minggu||'')===String(body.minggu||''));
  return {ok:true, dupe:!!d, info:d||null};
}

/* hapus baris PU+bulan tertentu (SEMUA minggu), lalu append data baru */
function replaceMonthData_(sheetName, pu, bulan, tahun, rows){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(sheetName);
  if(!sh){ sh=ss.insertSheet(sheetName); }
  const data=sh.getDataRange().getValues();
  let headers = data.length? data[0] : [];
  if(headers.length===0 && rows.length){ headers=['PU','Bulan','Tahun',...Object.keys(rows[0])]; sh.appendRow(headers); }
  if(headers.length===0) return;

  const iPU=headers.indexOf('PU'), iBl=headers.indexOf('Bulan'), iTh=headers.indexOf('Tahun');
  const keep=[headers];
  for(let r=1;r<data.length;r++){
    const row=data[r];
    const same = String(row[iPU])===String(pu) && String(row[iBl])===String(bulan) && String(row[iTh])===String(tahun);
    if(!same) keep.push(row);
  }
  rows.forEach(o=>{ keep.push(headers.map(h=> h==='PU'?pu : h==='Bulan'?bulan : h==='Tahun'?tahun : (o[h]!==undefined?o[h]:''))); });
  sh.clearContents();
  sh.getRange(1,1,keep.length,headers.length).setValues(keep);
}

/* hapus baris PU+bulan+MINGGU tertentu saja (berdasar tanggal r.tgl), lalu append baru */
function replaceWeekData_(sheetName, pu, bulan, tahun, minggu, rows){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(sheetName);
  if(!sh){ sh=ss.insertSheet(sheetName); }
  const data=sh.getDataRange().getValues();
  let headers = data.length? data[0] : [];
  if(headers.length===0 && rows.length){ headers=['PU','Bulan','Tahun',...Object.keys(rows[0])]; sh.appendRow(headers); }
  if(headers.length===0) return;

  const iPU=headers.indexOf('PU'), iBl=headers.indexOf('Bulan'), iTh=headers.indexOf('Tahun'), iTgl=headers.indexOf('Tgl');
  const keep=[headers];
  for(let r=1;r<data.length;r++){
    const row=data[r];
    const samePU = String(row[iPU])===String(pu) && String(row[iBl])===String(bulan) && String(row[iTh])===String(tahun);
    const sameWeek = samePU && iTgl>=0 && tanggalKeMinggu_(row[iTgl]) === minggu;
    if(!sameWeek) keep.push(row);
  }
  rows.forEach(o=>{ keep.push(headers.map(h=> h==='PU'?pu : h==='Bulan'?bulan : h==='Tahun'?tahun : (o[h]!==undefined?o[h]:''))); });
  sh.clearContents();
  sh.getRange(1,1,keep.length,headers.length).setValues(keep);
}

/* Tanggal (1-31 atau string tgl) -> nomor minggu ke berapa dalam bulan (1-5) */
function tanggalKeMinggu_(tglVal){
  let d = Number(String(tglVal).replace(/[^0-9]/g,'').slice(-2)) || Number(tglVal);
  if(!d || isNaN(d)) return 0;
  return Math.min(5, Math.ceil(d/7));
}

function logUpload_(pu,bulan,tahun,mode,minggu,nRows,nDup,replaced){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(CFG.SHEET_UPLOAD_LOG);
  if(!sh){ sh=ss.insertSheet(CFG.SHEET_UPLOAD_LOG); sh.appendRow(['Tanggal','PU','Bulan','Tahun','Mode','Minggu','Baris','DobelDibuang','Replace']); }
  sh.appendRow([new Date().toISOString(), pu, bulan, tahun, mode, minggu||'', nRows, nDup, replaced?'YA':'TIDAK']);
}
/* ====== 5. STATUS FINAL PER BULAN ====== */
/* SHEET_STATUS kolom: PU, Bulan, Tahun, Status(Draft/Final), DitandaiOleh, WaktuFinal */

function getUploadStatus_(pu, bulan, tahun){
  const rows = readSheet_(CFG.SHEET_STATUS);
  return rows.find(r=>String(r.PU)===String(pu) && String(r.Bulan)===String(bulan) && String(r.Tahun)===String(tahun)) || null;
}

function setUploadStatus_(pu, bulan, tahun, status, oleh){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(CFG.SHEET_STATUS);
  if(!sh){ sh=ss.insertSheet(CFG.SHEET_STATUS); sh.appendRow(['PU','Bulan','Tahun','Status','DitandaiOleh','WaktuFinal']); }
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iPU=headers.indexOf('PU'), iBl=headers.indexOf('Bulan'), iTh=headers.indexOf('Tahun');
  for(let r=1;r<data.length;r++){
    if(String(data[r][iPU])===String(pu) && String(data[r][iBl])===String(bulan) && String(data[r][iTh])===String(tahun)){
      sh.getRange(r+1,1,1,headers.length).setValues([[pu,bulan,tahun,status,oleh||'',status==='Final'?new Date().toISOString():'']]);
      return;
    }
  }
  sh.appendRow([pu,bulan,tahun,status,oleh||'',status==='Final'?new Date().toISOString():'']);
}

/* body: {pu, bulan, tahun, oleh} -> tandai Final, membuka akses rekonsiliasi */
function handleMarkFinal_(body){
  const {pu,bulan,tahun,oleh} = body;
  if(!pu||!bulan) return {ok:false, error:'PU & bulan wajib'};
  setUploadStatus_(pu, bulan, tahun||2026, 'Final', oleh||'Admin');
  return {ok:true, pu, bulan, tahun:tahun||2026, status:'Final'};
}

/* body: {pu, bulan, tahun} -> batalkan Final, supaya bisa upload ulang */
function handleUnmarkFinal_(body){
  const {pu,bulan,tahun} = body;
  if(!pu||!bulan) return {ok:false, error:'PU & bulan wajib'};
  setUploadStatus_(pu, bulan, tahun||2026, 'Draft', '');
  return {ok:true, pu, bulan, tahun:tahun||2026, status:'Draft'};
}

function handleGetUploadStatus_(p){
  const pu=p.pu, bulan=p.bulan, tahun=p.tahun||2026;
  const st = getUploadStatus_(pu, bulan, tahun);
  // ambil juga histori upload (per minggu/bulan) untuk bulan ini
  const log = readSheet_(CFG.SHEET_UPLOAD_LOG).filter(r=>String(r.PU)===String(pu)&&String(r.Bulan)===String(bulan)&&String(r.Tahun)===String(tahun));
  return {ok:true, status: st ? st.Status : 'Draft', ditandaiOleh: st?st.DitandaiOleh:'', waktuFinal: st?st.WaktuFinal:'', uploadHistory: log};
}

/* ====== 6. ORPHAN DETECTION ====== */
/* Setelah upload ulang, cek koreksi (yang sudah committed) yang RowKey-nya
   TIDAK LAGI ada di SIAP_DOWNTIME saat ini -> tandai perlu ditinjau ulang */
function checkOrphanKoreksi_(pu, bulan, tahun){
  const koreksi = readSheet_(CFG.SHEET_KOREKSI).filter(r=>
    String(r.PU)===String(pu) && String(r.Bulan)===String(bulan) && String(r.Tahun)===String(tahun) && r.Status==='Committed');
  if(!koreksi.length) return {count:0, detail:[]};

  const currentRows = readSheet_(CFG.SHEET_SIAP_DT).filter(r=>
    String(r.PU)===String(pu) && String(r.Bulan)===String(bulan) && String(r.Tahun)===String(tahun));
  const currentKeys = new Set(currentRows.map(r=>r.RowKey));

  const orphans = koreksi.filter(k=>!currentKeys.has(k.RowKey));
  if(orphans.length){
    markKoreksiOrphan_(orphans.map(o=>o.RowKey));
  }
  return {count: orphans.length, detail: orphans.slice(0,20).map(o=>({rowKey:o.RowKey, detail:o.Detail, kategoriBaru:o.KategoriBaru, sebabBaru:o.SebabBaru}))};
}

function markKoreksiOrphan_(rowKeys){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName(CFG.SHEET_KOREKSI);
  if(!sh) return;
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iKey=headers.indexOf('RowKey'), iStatus=headers.indexOf('Status');
  const keySet=new Set(rowKeys);
  for(let r=1;r<data.length;r++){
    if(keySet.has(data[r][iKey])){
      sh.getRange(r+1, iStatus+1).setValue('Orphan');
    }
  }
}
/* ====== 7. DRAFT KOREKSI (Kategori/Sebab) ====== */
/* SHEET_KOREKSI kolom:
   RowKey, PU, Bulan, Tahun, Tgl, Line, Detail,
   KategoriAsli, KategoriBaru, SebabAsli, SebabBaru,
   Status(Draft/Committed/Orphan), DiubahOleh, WaktuDiubah, WaktuCommit */

/* body: {action:'save_draft', pu, bulan, tahun, perubahan:[
     {rowKey, tgl, line, detail, kategoriAsli, kategoriBaru, sebabAsli, sebabBaru, oleh}
   ]}
   Menyimpan/update banyak baris sekaligus sebagai draft (belum committed). */
function handleSaveDraft_(body){
  const {pu, bulan, tahun, perubahan, oleh} = body;
  if(!perubahan || !perubahan.length) return {ok:false, error:'Tidak ada perubahan dikirim'};

  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(CFG.SHEET_KOREKSI);
  if(!sh){
    sh=ss.insertSheet(CFG.SHEET_KOREKSI);
    sh.appendRow(['RowKey','PU','Bulan','Tahun','Tgl','Line','Detail','KategoriAsli','KategoriBaru','SebabAsli','SebabBaru','Status','DiubahOleh','WaktuDiubah','WaktuCommit']);
  }
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iKey=headers.indexOf('RowKey');
  const rowIndexByKey={};
  for(let r=1;r<data.length;r++){ rowIndexByKey[data[r][iKey]] = r+1; }

  const now=new Date().toISOString();
  let nSaved=0;
  perubahan.forEach(c=>{
    const rowVals = [c.rowKey, pu, bulan, tahun, c.tgl||'', c.line||'', c.detail||'',
      c.kategoriAsli||'', c.kategoriBaru||c.kategoriAsli||'', c.sebabAsli||'', c.sebabBaru||c.sebabAsli||'',
      'Draft', oleh||'Tim', now, ''];
    if(rowIndexByKey[c.rowKey]){
      sh.getRange(rowIndexByKey[c.rowKey],1,1,headers.length).setValues([rowVals]);
    }else{
      sh.appendRow(rowVals);
    }
    nSaved++;
  });
  return {ok:true, saved:nSaved};
}

/* body: {action:'discard_draft', rowKeys:[...]} ATAU {pu,bulan,tahun,all:true} untuk buang semua draft bulan itu */
function handleDiscardDraft_(body){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName(CFG.SHEET_KOREKSI);
  if(!sh) return {ok:true, removed:0};
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iKey=headers.indexOf('RowKey'), iStatus=headers.indexOf('Status'),
        iPU=headers.indexOf('PU'), iBl=headers.indexOf('Bulan'), iTh=headers.indexOf('Tahun');

  const keySet = body.rowKeys ? new Set(body.rowKeys) : null;
  const keep=[headers];
  let removed=0;
  for(let r=1;r<data.length;r++){
    const row=data[r];
    const isDraft = row[iStatus]==='Draft';
    const matchKey = keySet ? keySet.has(row[iKey]) : true;
    const matchMonth = body.all ? (String(row[iPU])===String(body.pu)&&String(row[iBl])===String(body.bulan)&&String(row[iTh])===String(body.tahun)) : true;
    if(isDraft && matchKey && matchMonth){ removed++; continue; }
    keep.push(row);
  }
  sh.clearContents();
  sh.getRange(1,1,keep.length,headers.length).setValues(keep);
  return {ok:true, removed};
}

/* body: {action:'commit_koreksi', pu, bulan, tahun, oleh, rowKeys: [...] (opsional, kalau kosong = commit semua draft bulan ini) }
   Ini yang benar-benar "menerapkan" koreksi -> data yang dikirim ke dashboard (buildDowntime_)
   akan pakai KategoriBaru/SebabBaru untuk baris committed. Data ASLI di SIAP_DOWNTIME TIDAK diubah. */
function handleCommitKoreksi_(body){
  const {pu, bulan, tahun, oleh, rowKeys} = body;
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName(CFG.SHEET_KOREKSI);
  if(!sh) return {ok:false, error:'Belum ada draft koreksi'};
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iKey=headers.indexOf('RowKey'), iStatus=headers.indexOf('Status'), iCommit=headers.indexOf('WaktuCommit'),
        iPU=headers.indexOf('PU'), iBl=headers.indexOf('Bulan'), iTh=headers.indexOf('Tahun');
  const keySet = rowKeys && rowKeys.length ? new Set(rowKeys) : null;

  const now=new Date().toISOString();
  let nCommit=0;
  for(let r=1;r<data.length;r++){
    const row=data[r];
    const matchMonth = String(row[iPU])===String(pu)&&String(row[iBl])===String(bulan)&&String(row[iTh])===String(tahun);
    const matchKey = keySet ? keySet.has(row[iKey]) : true;
    if(row[iStatus]==='Draft' && matchMonth && matchKey){
      sh.getRange(r+1, iStatus+1).setValue('Committed');
      sh.getRange(r+1, iCommit+1).setValue(now);
      nCommit++;
    }
  }
  logRekonCommit_(pu, bulan, tahun, oleh||'Tim', nCommit);
  return {ok:true, committed:nCommit};
}

function logRekonCommit_(pu,bulan,tahun,oleh,nRows){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(CFG.SHEET_REKON_LOG);
  if(!sh){ sh=ss.insertSheet(CFG.SHEET_REKON_LOG); sh.appendRow(['Waktu','PU','Bulan','Tahun','Oleh','JumlahBarisDikoreksi']); }
  sh.appendRow([new Date().toISOString(), pu, bulan, tahun, oleh, nRows]);
}

function handleGetRekonLog_(p){
  const rows = readSheet_(CFG.SHEET_REKON_LOG);
  const filtered = p.pu ? rows.filter(r=>String(r.PU)===String(p.pu)&&String(r.Bulan)===String(p.bulan)&&String(r.Tahun)===String(p.tahun||2026)) : rows;
  return {ok:true, log: filtered.slice(-50).reverse()};
}

/* Ambil map koreksi (RowKey -> {kategoriBaru, sebabBaru}) untuk status tertentu,
   dipakai saat build payload (Committed) dan saat tampilkan draft (Draft) */
function getKoreksiMap_(pu, bulan, tahun, status){
  const rows = readSheet_(CFG.SHEET_KOREKSI).filter(r=>
    String(r.PU)===String(pu) && String(r.Bulan)===String(bulan) && String(r.Tahun)===String(tahun) && r.Status===status);
  const map={};
  rows.forEach(r=>{ map[r.RowKey] = {
    kategoriBaru:r.KategoriBaru, sebabBaru:r.SebabBaru, detail:r.Detail,
    kategoriAsli:r.KategoriAsli, sebabAsli:r.SebabAsli,
    diubahOleh:r.DiubahOleh, waktuCommit:r.WaktuCommit
  }; });
  return map;
}
/* ====== 8. ATURAN SCREENING (kata kunci -> kategori/sebab disarankan) ====== */
/* SHEET_RULE_KAT kolom: KataKunci, KategoriDisarankan
   SHEET_RULE_SEBAB kolom: KataKunci, SebabDisarankan, Konsistensi(opsional, info saja) */

function readRuleKategori_(){
  return readSheet_(CFG.SHEET_RULE_KAT).filter(r=>r.KataKunci && r.KategoriDisarankan)
    .map(r=>({kata:String(r.KataKunci).toLowerCase().trim(), kategori:r.KategoriDisarankan}));
}
function readRuleSebab_(){
  return readSheet_(CFG.SHEET_RULE_SEBAB).filter(r=>r.KataKunci && r.SebabDisarankan)
    .map(r=>({kata:String(r.KataKunci).toLowerCase().trim(), sebab:r.SebabDisarankan, konsistensi:r.Konsistensi||''}));
}

/* body: {action:'save_rule', jenis:'kategori'|'sebab', kataKunci, target} */
function handleSaveRule_(body){
  const {jenis, kataKunci, target} = body;
  if(!jenis || !kataKunci || !target) return {ok:false, error:'jenis, kataKunci, target wajib'};
  const sheetName = jenis==='kategori' ? CFG.SHEET_RULE_KAT : CFG.SHEET_RULE_SEBAB;
  const targetCol = jenis==='kategori' ? 'KategoriDisarankan' : 'SebabDisarankan';
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(sheetName);
  if(!sh){ sh=ss.insertSheet(sheetName); sh.appendRow(['KataKunci', targetCol, 'Konsistensi']); }
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iKata=headers.indexOf('KataKunci');
  for(let r=1;r<data.length;r++){
    if(String(data[r][iKata]).toLowerCase()===String(kataKunci).toLowerCase()){
      sh.getRange(r+1,2).setValue(target);
      return {ok:true, updated:true};
    }
  }
  sh.appendRow([kataKunci, target, '']);
  return {ok:true, added:true};
}

function handleDeleteRule_(body){
  const {jenis, kataKunci} = body;
  const sheetName = jenis==='kategori' ? CFG.SHEET_RULE_KAT : CFG.SHEET_RULE_SEBAB;
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName(sheetName);
  if(!sh) return {ok:true, removed:0};
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iKata=headers.indexOf('KataKunci');
  const keep=[headers];
  let removed=0;
  for(let r=1;r<data.length;r++){
    if(String(data[r][iKata]).toLowerCase()===String(kataKunci).toLowerCase()){ removed++; continue; }
    keep.push(data[r]);
  }
  sh.clearContents();
  sh.getRange(1,1,keep.length,headers.length).setValues(keep);
  return {ok:true, removed};
}

/* ====== 9. JALANKAN SCREENING ====== */
/* p: {pu, bulan, tahun} -> {ok, kategori:[{kataKunci,kategoriDisarankan,groups:[{kategoriSekarang,count,contoh:[...]}]}],
                              sebab:[...], matrix:[{kategori,total,op,tr,status}]} */
function handleGetScreening_(p){
  const pu=p.pu, bulan=p.bulan, tahun=p.tahun||2026;
  const rows = getEffectiveDowntimeRows_(pu, bulan, tahun); // sudah termasuk koreksi Committed + Draft ter-apply
  const ruleKat = readRuleKategori_();
  const ruleSebab = readRuleSebab_();

  // --- Screening Kategori ---
  const katGroups = {}; // key: kataKunci|kategoriSekarang -> {kategoriDisarankan,count,contoh:[],rowKeys:[]}
  rows.forEach(r=>{
    const desk = String(r.Detail||'').toLowerCase();
    for(const rule of ruleKat){
      if(rule.kategori === r.Kategori) continue; // sudah sesuai
      if(desk.indexOf(rule.kata) === -1) continue;
      const gkey = rule.kata+'|'+r.Kategori+'|'+rule.kategori;
      if(!katGroups[gkey]) katGroups[gkey] = {kataKunci:rule.kata, kategoriSekarang:r.Kategori, kategoriDisarankan:rule.kategori, count:0, contoh:[], rowKeys:[]};
      katGroups[gkey].count++;
      if(katGroups[gkey].contoh.length<8) katGroups[gkey].contoh.push({detail:r.Detail, tgl:r.Tgl, line:r.Line, rowKey:r.RowKey});
      katGroups[gkey].rowKeys.push(r.RowKey);
      break; // satu rule per baris cukup
    }
  });

  // --- Screening Sebab ---
  const sebabGroups = {};
  rows.forEach(r=>{
    const desk = String(r.Detail||'').toLowerCase();
    for(const rule of ruleSebab){
      if(rule.sebab === r.Sebab) continue;
      if(desk.indexOf(rule.kata) === -1) continue;
      const gkey = rule.kata+'|'+r.Sebab+'|'+rule.sebab;
      if(!sebabGroups[gkey]) sebabGroups[gkey] = {kataKunci:rule.kata, sebabSekarang:r.Sebab, sebabDisarankan:rule.sebab, konsistensi:rule.konsistensi, count:0, contoh:[], rowKeys:[]};
      sebabGroups[gkey].count++;
      if(sebabGroups[gkey].contoh.length<8) sebabGroups[gkey].contoh.push({detail:r.Detail, tgl:r.Tgl, line:r.Line, rowKey:r.RowKey});
      sebabGroups[gkey].rowKeys.push(r.RowKey);
      break;
    }
  });

  // --- Matrix konsistensi Kategori x Sebab ---
  const katStat = {};
  rows.forEach(r=>{
    if(r.Sebab!=='OP' && r.Sebab!=='TR') return;
    if(!katStat[r.Kategori]) katStat[r.Kategori]={op:0,tr:0};
    katStat[r.Kategori][r.Sebab.toLowerCase()]++;
  });
  const matrix = Object.keys(katStat).map(k=>{
    const s=katStat[k], total=s.op+s.tr;
    const domPct = Math.max(s.op,s.tr)/total*100;
    return {kategori:k, total, op:s.op, tr:s.tr, opPct:Math.round(s.op/total*100), trPct:Math.round(s.tr/total*100),
      status: (domPct<90 && total>=20) ? 'Campuran' : 'Konsisten'};
  }).sort((a,b)=>b.total-a.total);

  return {ok:true,
    kategori: Object.values(katGroups).sort((a,b)=>b.count-a.count),
    sebab: Object.values(sebabGroups).sort((a,b)=>b.count-a.count),
    matrix: matrix,
    totalBaris: rows.length,
    totalDiflagKategori: Object.values(katGroups).reduce((s,g)=>s+g.count,0),
    totalDiflagSebab: Object.values(sebabGroups).reduce((s,g)=>s+g.count,0)
  };
}

/* ====== 10. SEMUA DOWNTIME (tabel lengkap, dengan filter) ====== */
/* p: {pu, bulan, tahun, filterPU, filterLine, filterKategori, filterSebab, cari, hanyaFlag, page, pageSize} */
function handleGetAllDowntime_(p){
  const pu=p.pu, bulan=p.bulan, tahun=p.tahun||2026;
  let rows = getEffectiveDowntimeRows_(pu, bulan, tahun);

  if(p.filterPU)       rows = rows.filter(r=>r.PU===p.filterPU);
  if(p.filterLine)     rows = rows.filter(r=>r.Line===p.filterLine);
  if(p.filterKategori) rows = rows.filter(r=>r.Kategori===p.filterKategori);
  if(p.filterSebab)    rows = rows.filter(r=>r.Sebab===p.filterSebab);
  if(p.cari)           rows = rows.filter(r=>String(r.Detail||'').toLowerCase().indexOf(String(p.cari).toLowerCase())>=0);

  if(p.hanyaFlag==='true' || p.hanyaFlag===true){
    const ruleKat = readRuleKategori_(), ruleSebab = readRuleSebab_();
    rows = rows.filter(r=>{
      const desk = String(r.Detail||'').toLowerCase();
      const flagKat = ruleKat.some(rule=>rule.kategori!==r.Kategori && desk.indexOf(rule.kata)>=0);
      const flagSebab = ruleSebab.some(rule=>rule.sebab!==r.Sebab && desk.indexOf(rule.kata)>=0);
      return flagKat || flagSebab;
    });
  }

  const total = rows.length;
  const pageSize = Number(p.pageSize)||200;
  const page = Number(p.page)||1;
  const start = (page-1)*pageSize;
  const paged = rows.slice(start, start+pageSize);

  return {ok:true, total, page, pageSize, totalPage: Math.ceil(total/pageSize), rows: paged};
}

/* Ambil baris downtime "efektif": data asli SIAP_DOWNTIME + koreksi (Committed selalu,
   Draft juga di-apply supaya tim bisa lihat efek sebelum commit) */
function getEffectiveDowntimeRows_(pu, bulan, tahun){
  const raw = readSheet_(CFG.SHEET_SIAP_DT).filter(r=>
    String(r.PU)===String(pu) && String(r.Bulan)===String(bulan) && String(r.Tahun)===String(tahun));
  const committed = getKoreksiMap_(pu, bulan, tahun, 'Committed');
  const draft = getKoreksiMap_(pu, bulan, tahun, 'Draft');

  return raw.map(r=>{
    const out = Object.assign({}, r);
    if(committed[r.RowKey]){
      out.KategoriAsli = r.Kategori; out.SebabAsli = r.Sebab;
      out.Kategori = committed[r.RowKey].kategoriBaru || r.Kategori;
      out.Sebab = committed[r.RowKey].sebabBaru || r.Sebab;
      out._koreksiStatus = 'Committed';
    }
    if(draft[r.RowKey]){
      out.KategoriAsli = out.KategoriAsli || r.Kategori; out.SebabAsli = out.SebabAsli || r.Sebab;
      out.Kategori = draft[r.RowKey].kategoriBaru || out.Kategori;
      out.Sebab = draft[r.RowKey].sebabBaru || out.Sebab;
      out._koreksiStatus = 'Draft';
    }
    return out;
  });
}
/* ====== 11. BACA + OLAH (doGet payload utama) ====== */
function buildPayload_(){
  const dtRaw = readSheet_(CFG.SHEET_SIAP_DT);
  const downtime = buildDowntime_(dtRaw);
  const oee = buildOEE_();
  const master = {
    pic: readPic_(), tolRules: readTol_(), klas: readKlas_(),
    mesin: readSheet_(CFG.SHEET_MESIN), kapasitas: readKap_(),
    target: readTargetMap_(), actions: readActions_(), costParam: readCostParam_()
  };
  return Object.assign({}, downtime, {oee:oee, master:master});
}

/* olah downtime mentah -> encoded payload.
   REVISI Fase 3: tambah 'sebab' sebagai kolom baru di dt[], dan terapkan koreksi
   Committed dari REKONSILIASI_KOREKSI sebelum encoding (supaya KPI di dashboard
   sudah mencerminkan hasil rekonsiliasi yang sudah final, bukan data mentah). */
function buildDowntime_(raw){
  if(!raw.length) return {dt:[], op:[], mesin:[], kat:[], fungsi:[], sub:[], produk:[], sebabList:['OP','TR'],
    cls:['Breakdown','Waiting','Setup','Quality','Eksternal'],
    big6:['Breakdown','Setup/Adjustment','Idling/Waiting','Quality/Defect','Lainnya'], _empty:true, koreksiInfo:[]};

  // --- terapkan koreksi Committed per PU+Bulan+Tahun yang ada di raw ---
  const bulanSet = new Set(raw.map(r=>r.PU+'|'+r.Bulan+'|'+r.Tahun));
  const koreksiByKey = {};
  bulanSet.forEach(k=>{
    const [pu,bulan,tahun]=k.split('|');
    Object.assign(koreksiByKey, getKoreksiMap_(pu, bulan, tahun, 'Committed'));
  });
  // Simpan daftar info koreksi TERPISAH (index dirujuk dari dt[], bukan disisipkan
  // langsung supaya array dt[] tetap ringan berisi angka/index saja).
  const koreksiInfo = []; // [{rowKey, kategoriAsli, sebabAsli, diubahOleh, waktuCommit}]
  const koreksiInfoIdx = {}; // rowKey -> index di koreksiInfo
  raw.forEach(r=>{
    const k = koreksiByKey[r.RowKey];
    if(k){
      if(k.kategoriBaru) r.Kategori = k.kategoriBaru;
      if(k.sebabBaru) r.Sebab = k.sebabBaru;
      koreksiInfoIdx[r.RowKey] = koreksiInfo.length;
      koreksiInfo.push({rowKey:r.RowKey, kategoriAsli:k.kategoriAsli||'', sebabAsli:k.sebabAsli||'',
        diubahOleh:k.diubahOleh||'', waktuCommit:k.waktuCommit||''});
    }
  });

  const mesinSet=new Set(),katSet=new Set(),fungsiSet=new Set(),subSet=new Set(),produkSet=new Set();
  raw.forEach(r=>{ mesinSet.add(r.Mesin);katSet.add(r.Kategori);fungsiSet.add(r.Fungsi);subSet.add(r.Sub); produkSet.add(r.Produk||''); });
  const mesin=[...mesinSet].sort(),kat=[...katSet].sort(),fungsi=[...fungsiSet].sort(),sub=[...subSet].sort(),produk=[...produkSet].sort();
  const cls=['Breakdown','Waiting','Setup','Quality','Eksternal'];
  const big6=['Breakdown','Setup/Adjustment','Idling/Waiting','Quality/Defect','Lainnya'];
  const sebabList=['OP','TR'];
  const puMap={'PUJ':0,'PUC':1,'PUG':2}, idx=(a,v)=>a.indexOf(v);
  const dt=[],opAgg={};
  raw.forEach(r=>{
    const d=Number(r.Downtime)||0, op=Number(r.OpTime)||0;
    if(d>0) dt.push([puMap[r.PU]||0, Number(r.Bulan)||0, idx(mesin,r.Mesin), idx(kat,r.Kategori), idx(fungsi,r.Fungsi),
      Math.round(d*100)/100, Number(r.LossKL)||0, 0, String(r.Detail||'').slice(0,70), String(r.Tgl||''), String(r.Line||''),
      idx(sub,r.Sub), Number(r.Shift!=null?r.Shift:-1), Number(r.DOW!=null?r.DOW:-1),
      Math.max(0,idx(cls,r.Klasifikasi)), idx(big6,r.Big6)>=0?idx(big6,r.Big6):4,
      sebabList.indexOf(r.Sebab)>=0?sebabList.indexOf(r.Sebab):-1,   // index 16: sebab
      r.RowKey||'',                                                   // index 17: rowKey (string, untuk rekonsiliasi)
      koreksiInfoIdx[r.RowKey]!=null?koreksiInfoIdx[r.RowKey]:-1,      // index 18: index ke koreksiInfo[], -1 jika tidak dikoreksi
      idx(produk,r.Produk||''),                                       // index 19: index ke produk[] (BARU)
      String(r.Batch||''),                                            // index 20: nomor batch, string langsung (BARU)
      String(r.Kimap||''), String(r.Solusi||'').slice(0,80),           // index 21-22: Kimap, Solusi (BARU)
      String(r.Awal||''), String(r.Akhir||'')]);                       // index 23-24: jam Awal, Akhir (BARU)
    if(op>0){ const k=[puMap[r.PU],r.Bulan,r.Mesin].join('|'); opAgg[k]=(opAgg[k]||0)+op; }
  });
  const opArr=Object.keys(opAgg).map(k=>{const[pu,bl,ms]=k.split('|');return[Number(pu),Number(bl),idx(mesin,ms),Math.round(opAgg[k]*100)/100];});
  return {dt, op:opArr, mesin, kat, fungsi, sub, produk, cls, big6, sebabList, koreksiInfo};
}

function buildOEE_(){
  return {
    kapasitas: readKap_(),
    tipeList: readTipeList_(),
    mesinMaster: readSheet_(CFG.SHEET_MESIN)
  };
}

/* ====== 12. SIMPAN MASTER (doPost save_master) ====== */
function handleSaveMaster_(body){
  const s=body.sections||{};
  const saved=[];
  if(s.kapasitas){
    const invalid = s.kapasitas.filter(r=>Number(r.Kapasitas)<=0 || isNaN(Number(r.Kapasitas)));
    if(invalid.length) return {ok:false, error:`${invalid.length} baris kapasitas bernilai 0/negatif/bukan angka (contoh: ${invalid[0].Mesin||'?'}). Perbaiki nilai tersebut sebelum menyimpan.`};
    saveSection_('kapasitas', s.kapasitas, body.uid); saved.push('kapasitas');
  }
  if(s.pic){ saveSection_('pic', s.pic, body.uid); saved.push('pic'); }
  if(s.toleransi){
    const invalid = s.toleransi.filter(r=>Number(r.Factor)<0 || Number(r.Factor)>1 || isNaN(Number(r.Factor)));
    if(invalid.length) return {ok:false, error:`${invalid.length} baris toleransi di luar rentang 0-1 (contoh: ${invalid[0].Target||'?'}). Faktor toleransi harus antara 0 dan 1.`};
    saveSection_('toleransi', s.toleransi, body.uid); saved.push('toleransi');
  }
  if(s.mesin){ saveSection_('mesin', s.mesin, body.uid); saved.push('mesin'); }
  if(s.klasifikasi){ saveSection_('klasifikasi', s.klasifikasi, body.uid); saved.push('klasifikasi'); }
  if(s.target){
    const invalid = s.target.filter(r=>Number(r.Value)<0 || isNaN(Number(r.Value)));
    if(invalid.length) return {ok:false, error:`${invalid.length} baris target bernilai negatif/bukan angka (contoh: ${invalid[0].Target||'?'}).`};
    saveSection_('target', s.target, body.uid); saved.push('target');
  }
  if(s.action){ saveSection_('action', s.action, body.uid); saved.push('action'); }
  if(s.costParam){
    const invalid = s.costParam.filter(r=>Number(r.CostPerJam)<0 || Number(r.CostPerKL)<0 || isNaN(Number(r.CostPerJam)) || isNaN(Number(r.CostPerKL)));
    if(invalid.length) return {ok:false, error:`${invalid.length} baris cost parameter bernilai negatif/bukan angka (contoh: ${invalid[0].PU||'?'}).`};
    saveSection_('costParam', s.costParam, body.uid); saved.push('costParam');
  }
  return {ok:true, saved};
}

function saveSection_(kind, rows, oleh, skipHistory){
  const map={pic:CFG.SHEET_PIC,toleransi:CFG.SHEET_TOL,action:CFG.SHEET_ACTION,
             klasifikasi:CFG.SHEET_KLAS,target:CFG.SHEET_TARGET,mesin:CFG.SHEET_MESIN,kapasitas:CFG.SHEET_KAP,
             costParam:CFG.SHEET_COST};
  const name=map[kind]; if(!name) throw new Error('Unknown kind: '+kind);
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(name); if(!sh) sh=ss.insertSheet(name);

  // Catat riwayat versi SEBELUM ditimpa (untuk fitur Undo), kecuali saat proses undo itu sendiri.
  if(!skipHistory){
    const dataLama = readSheet_(name);
    if(dataLama.length) catatMasterHistory_(kind, dataLama, oleh);
  }

  sh.clearContents();
  if(!rows.length) return; // catatan: sengaja tidak menulis header jika rows kosong -- ini kondisi tak lazim
                            // (frontend semestinya selalu mengirim minimal 1 baris untuk section aktif)
  const headers=Object.keys(rows[0]);
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.getRange(2,1,rows.length,headers.length).setValues(rows.map(r=>headers.map(h=>r[h])));
}

/* ====== 13. HELPER BACA MASTER ====== */
function readPic_(){
  const rows=readSheet_(CFG.SHEET_PIC); const out={fungsi:{},sub:{},kat:{}};
  rows.forEach(r=>{ if(r.Level&&r.Target&&r.PIC) out[r.Level][r.Target]=r.PIC; });
  if(!Object.keys(out.fungsi).length){ out.fungsi={Production:'Manager Produksi','Quality Assurance':'Manager QA','Technical Services':'Manager Technical Services',Distribution:'Manager Distribusi'}; out.sub={'Production RMP':'Spv RMP','Quality-Lab':'Spv Lab','Quality-Inspection':'Spv Inspeksi'}; }
  return out;
}
function readTol_(){
  const rows=readSheet_(CFG.SHEET_TOL);
  const out=rows.filter(r=>r.Level&&r.Target).map(r=>({level:r.Level,target:r.Target,factor:Number(r.Factor)||0.6}));
  return out.length?out:[{level:'fungsi',target:'Distribution',factor:0.6},{level:'sub',target:'Production RMP',factor:0.6},{level:'kat',target:'Tunggu Mobil Flexi/IBC',factor:0.6}];
}
function readKlas_(){ const rows=readSheet_(CFG.SHEET_KLAS); const o={}; rows.forEach(r=>{if(r.Kategori)o[r.Kategori]=r.Klasifikasi;}); return o; }
function readActions_(){ const rows=readSheet_(CFG.SHEET_ACTION); const o={}; rows.forEach(r=>{if(r.Key)o[r.Key]={status:r.Status||'open',note:r.Note||'',pic:r.PIC||''};}); return o; }
/* Parameter cost per PU: Rp per jam produksi & Rp per KL — dipakai kalikan downtime jadi Rupiah.
   Default 0 kalau belum pernah diisi (Master Data > Cost Parameter di dashboard). */
function readCostParam_(){
  const rows=readSheet_(CFG.SHEET_COST);
  const out={PUJ:{costPerJam:0,costPerKL:0}, PUC:{costPerJam:0,costPerKL:0}, PUG:{costPerJam:0,costPerKL:0}};
  rows.forEach(r=>{ if(r.PU) out[r.PU]={costPerJam:Number(r.CostPerJam)||0, costPerKL:Number(r.CostPerKL)||0}; });
  return out;
}
function readKap_(){ return readSheet_(CFG.SHEET_KAP).map(r=>({pu:r.PU,mesin:r.Mesin,ukuran:r.Ukuran,kapasitas:Number(r.Kapasitas)||0,satuanPerKemasan:r.SatuanPerKemasan||1})); }
function readTargetMap_(){ const rows=readSheet_(CFG.SHEET_TARGET); const o={}; rows.forEach(r=>{if(r.Target)o[r.Target]=Number(r.Value);}); return o; }
function readTipeList_(){
  const rows=readSheet_(CFG.SHEET_MESIN); const s=new Set(['Lithos','Curah','Drum','Grease']);
  rows.forEach(r=>{ if(r.Tipe) s.add(r.Tipe); }); return [...s];
}

/* ====== 14. UTIL ====== */
function readSheet_(name){
  const ss=SpreadsheetApp.getActiveSpreadsheet(), sh=ss.getSheetByName(name);
  if(!sh) return [];
  const data=sh.getDataRange().getValues(); if(data.length<2) return [];
  const h=data[0]; return data.slice(1).map(row=>{const o={};h.forEach((k,i)=>o[k]=row[i]);return o;});
}
/* Sama seperti readSheet_ tapi tiap object dikasih tambahan _row (nomor baris asli di sheet,
   baris data pertama = 2) — dipakai buat laporan "baris ke berapa yang bermasalah". */
function readSheetWithRow_(name){
  const ss=SpreadsheetApp.getActiveSpreadsheet(), sh=ss.getSheetByName(name);
  if(!sh) return [];
  const data=sh.getDataRange().getValues(); if(data.length<2) return [];
  const h=data[0];
  return data.slice(1).map((row,i)=>{const o={_row:i+2};h.forEach((k,ci)=>o[k]=row[ci]);return o;});
}
function json_(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/* ====== 15. SETUP AWAL — jalankan SEKALI (atau ulang setelah update ke Fase 3) ====== */
function setupSheets(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const defs={
    [CFG.SHEET_SIAP_DT]:['PU','Bulan','Tahun','Mesin','Kategori','Fungsi','Sub','Downtime','OpTime','LossKL','Detail','Tgl','Line','Shift','DOW','Klasifikasi','Big6','Sebab','RowKey','Produk','Batch','Kimap','Solusi','Awal','Akhir'],
    [CFG.SHEET_SIAP_HP]:['PU','Bulan','Tahun','Tipe','Line','Kimap','Produk','Ukuran','Jumlah','Reject'],
    [CFG.SHEET_SIAP_NETOP]:['PU','Bulan','Tahun','Line','Tanggal','NetOp'],
    [CFG.SHEET_SIAP_PMK]:['PU','Bulan','Tahun','Material','Deskripsi','Reject'],
    [CFG.SHEET_UPLOAD_LOG]:['Tanggal','PU','Bulan','Tahun','Mode','Minggu','Baris','DobelDibuang','Replace'],
    [CFG.SHEET_PIC]:['Level','Target','PIC'],
    [CFG.SHEET_TOL]:['Level','Target','Factor'],
    [CFG.SHEET_KLAS]:['Kategori','Klasifikasi'],
    [CFG.SHEET_MESIN]:['PU','Mesin','Tipe','Include'],
    [CFG.SHEET_KAP]:['PU','Mesin','Ukuran','Kapasitas','SatuanPerKemasan'],
    [CFG.SHEET_TARGET]:['Level','Target','Value'],
    [CFG.SHEET_ACTION]:['Key','Status','Note','PIC'],
    // ===== Fase 3 =====
    [CFG.SHEET_KOREKSI]:['RowKey','PU','Bulan','Tahun','Tgl','Line','Detail','KategoriAsli','KategoriBaru','SebabAsli','SebabBaru','Status','DiubahOleh','WaktuDiubah','WaktuCommit'],
    [CFG.SHEET_STATUS]:['PU','Bulan','Tahun','Status','DitandaiOleh','WaktuFinal'],
    [CFG.SHEET_RULE_KAT]:['KataKunci','KategoriDisarankan','Konsistensi'],
    [CFG.SHEET_RULE_SEBAB]:['KataKunci','SebabDisarankan','Konsistensi'],
    [CFG.SHEET_REKON_LOG]:['Waktu','PU','Bulan','Tahun','Oleh','JumlahBarisDikoreksi'],
    // ===== Fase 4 =====
    [CFG.SHEET_USERS]:['UID','Password','Role','Nama','Aktif'],
    [CFG.SHEET_LOGIN_LOG]:['Waktu','UID'],
    [CFG.SHEET_ACTIVITY]:['Waktu','UID','Action','Berhasil','Detail'],
    [CFG.SHEET_BACKUP]:['Waktu','PU','Bulan','Tahun','JumlahBarisSebelum','Oleh','Catatan'],
    [CFG.SHEET_MASTER_HIST]:['Waktu','Kind','DataJSON','Oleh'],
    [CFG.SHEET_ACTIVE_SESSION]:['UID','Nama','Modul','WaktuUpdate'],
    // ===== BARU — Konversi Raw SIAP =====
    [CFG.SHEET_RAW_IMPORT]:['PU','Bulan','Tahun','Tgl post','Line','Detail','Sebab','Kategori','Durasi'],
    [CFG.SHEET_KODE_KATEGORI]:['Kode','KategoriResmi'],
    [CFG.SHEET_KONVERSI_LOG]:['Waktu','PU','Bulan','Tahun','BarisMasuk','BarisJadiDowntime','BarisJadiOpTime','KodeTidakDikenal','Oleh'],
  };
  Object.keys(defs).forEach(name=>{ let sh=ss.getSheetByName(name); if(!sh)sh=ss.insertSheet(name); sh.clearContents(); sh.getRange(1,1,1,defs[name].length).setValues([defs[name]]); });
  seedAturanScreeningAwal_();
  seedAdminDefault_();
  seedKodeKategoriAwal_();
  SpreadsheetApp.getUi().alert('✓ Semua sheet OPS PERFORMANCE HUB sudah dibuat.\n\nAkun admin default: UID "admin", password "admin123ganti" — SEGERA GANTI password ini dari dashboard (Kelola User) setelah login pertama kali.\n\nAturan screening awal (kata kunci) sudah diisi contoh dasar — silakan tambah/ubah di tab REKON_ATURAN_KATEGORI dan REKON_ATURAN_SEBAB, atau langsung dari dashboard.\n\nMD_KODE_KATEGORI sudah diisi 59 kode kategori yang diketahui (TL, TS, FL, dst) — kalau ada kode baru yang belum kemapping (dashboard akan flag saat convert), tambahkan di tab ini.');
}

/* Membuat 1 akun admin default supaya ada akses awal ke dashboard setelah setup.
   PENTING: ganti password ini segera dari dashboard (Kelola User) setelah setup selesai. */
function seedAdminDefault_(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName(CFG.SHEET_USERS);
  if(sh.getLastRow()<2){
    sh.appendRow(['admin','admin123ganti','admin','Administrator', true]);
  }
}

/* ====== FASE 4 — MANAJEMEN USER (khusus admin) ====== */
function handleGetUsers_(p){
  if(!isAdmin_(p.uid)) return {ok:false, error:'FORBIDDEN', message:'Hanya admin yang dapat melihat daftar user.'};
  const users = readSheet_(CFG.SHEET_USERS).map(u=>({uid:u.UID, nama:u.Nama, role:u.Role, aktif:u.Aktif}));
  return {ok:true, users}; // password sengaja TIDAK dikirim balik ke frontend
}
function handleCreateUser_(body){
  if(!isAdmin_(body.uid)) return {ok:false, error:'FORBIDDEN', message:'Hanya admin yang dapat membuat user baru.'};
  const {newUid, newPassword, newNama, newRole} = body;
  if(!newUid || !newPassword) return {ok:false, error:'UID dan password wajib diisi'};
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName(CFG.SHEET_USERS);
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iUid=headers.indexOf('UID');
  for(let r=1;r<data.length;r++){ if(String(data[r][iUid])===String(newUid)) return {ok:false, error:'UID sudah dipakai'}; }
  sh.appendRow([newUid, newPassword, newRole||'user', newNama||newUid, true]);
  return {ok:true, created:newUid};
}
function handleUpdateUser_(body){
  if(!isAdmin_(body.uid)) return {ok:false, error:'FORBIDDEN', message:'Hanya admin yang dapat mengubah user.'};
  const {targetUid, newPassword, newNama, newRole, newAktif} = body;
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName(CFG.SHEET_USERS);
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iUid=headers.indexOf('UID'), iPw=headers.indexOf('Password'), iNama=headers.indexOf('Nama'), iRole=headers.indexOf('Role'), iAktif=headers.indexOf('Aktif');
  for(let r=1;r<data.length;r++){
    if(String(data[r][iUid])===String(targetUid)){
      if(newPassword) sh.getRange(r+1,iPw+1).setValue(newPassword);
      if(newNama!=null) sh.getRange(r+1,iNama+1).setValue(newNama);
      if(newRole) sh.getRange(r+1,iRole+1).setValue(newRole);
      if(newAktif!=null) sh.getRange(r+1,iAktif+1).setValue(newAktif);
      return {ok:true, updated:targetUid};
    }
  }
  return {ok:false, error:'User tidak ditemukan'};
}
function handleDeleteUser_(body){
  if(!isAdmin_(body.uid)) return {ok:false, error:'FORBIDDEN', message:'Hanya admin yang dapat menghapus user.'};
  if(String(body.targetUid)===String(body.uid)) return {ok:false, error:'Tidak bisa menghapus akun sendiri yang sedang login'};
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName(CFG.SHEET_USERS);
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iUid=headers.indexOf('UID');
  const keep=[headers]; let removed=false;
  for(let r=1;r<data.length;r++){
    if(String(data[r][iUid])===String(body.targetUid)){ removed=true; continue; }
    keep.push(data[r]);
  }
  sh.clearContents(); sh.getRange(1,1,keep.length,headers.length).setValues(keep);
  return {ok:removed, error: removed?undefined:'User tidak ditemukan'};
}

/* ====== FASE 4 — LOG AKTIVITAS & LOGIN (dapat dilihat admin dari dashboard) ====== */
function handleGetActivityLog_(p){
  if(!isAdmin_(p.uid)) return {ok:false, error:'FORBIDDEN', message:'Hanya admin yang dapat melihat log aktivitas.'};
  const rows = readSheet_(CFG.SHEET_ACTIVITY);
  return {ok:true, log: rows.slice(-200).reverse()};
}
function handleGetLoginLog_(p){
  if(!isAdmin_(p.uid)) return {ok:false, error:'FORBIDDEN', message:'Hanya admin yang dapat melihat log login.'};
  const rows = readSheet_(CFG.SHEET_LOGIN_LOG);
  return {ok:true, log: rows.slice(-200).reverse()};
}

/* ====== FASE 4 — BACKUP SNAPSHOT SEBELUM REPLACE DATA BULANAN ====== */
/* Dipanggil otomatis dari dalam replaceMonthData_/replaceWeekData_ (lihat bagian upload).
   Menyimpan RINGKASAN (jumlah baris, bukan seluruh data mentah) sebelum data lama dihapus,
   supaya ada jejak untuk investigasi jika ada upload yang keliru. */
function catatBackupSnapshot_(pu, bulan, tahun, jumlahBarisSebelum, oleh, catatan){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(CFG.SHEET_BACKUP);
  if(!sh){ sh=ss.insertSheet(CFG.SHEET_BACKUP); sh.appendRow(['Waktu','PU','Bulan','Tahun','JumlahBarisSebelum','Oleh','Catatan']); }
  sh.appendRow([new Date().toISOString(), pu, bulan, tahun, jumlahBarisSebelum, oleh||'?', catatan||'']);
}

/* ====== FASE 4 — RIWAYAT & UNDO MASTER DATA ====== */
/* Dipanggil dari dalam saveSection_ SEBELUM data lama ditimpa, supaya ada 1 langkah
   riwayat yang bisa dikembalikan (undo) jika suatu penyimpanan Master Data ternyata keliru. */
function catatMasterHistory_(kind, dataLamaRows, oleh){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(CFG.SHEET_MASTER_HIST);
  if(!sh){ sh=ss.insertSheet(CFG.SHEET_MASTER_HIST); sh.appendRow(['Waktu','Kind','DataJSON','Oleh']); }
  sh.appendRow([new Date().toISOString(), kind, JSON.stringify(dataLamaRows).slice(0,45000), oleh||'?']);
}
function handleGetMasterHistory_(p){
  const rows = readSheet_(CFG.SHEET_MASTER_HIST).filter(r=>!p.kind || r.Kind===p.kind);
  return {ok:true, history: rows.slice(-30).reverse().map(r=>({waktu:r.Waktu, kind:r.Kind, oleh:r.Oleh}))};
}
/* body: {kind, waktu, uid} -> kembalikan Master Data 'kind' ke versi pada 'waktu' tersebut */
function handleUndoMaster_(body){
  const rows = readSheet_(CFG.SHEET_MASTER_HIST).filter(r=>r.Kind===body.kind && r.Waktu===body.waktu);
  if(!rows.length) return {ok:false, error:'Riwayat tidak ditemukan'};
  const dataLama = JSON.parse(rows[0].DataJSON);
  saveSection_(body.kind, dataLama, body.uid, true); // true = jangan catat undo-nya sendiri ke history (hindari loop)
  return {ok:true, restored:body.kind, rows:dataLama.length};
}

/* ====== FASE 4 — SESI AKTIF (notifikasi lintas-user) ====== */
/* Dipanggil berkala (heartbeat) dari dashboard tiap ~20 detik selama modul Rekonsiliasi
   terbuka, supaya user lain tahu ada rekan yang sedang bekerja di PU/Bulan yang sama. */
function handleHeartbeatSession_(body){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(CFG.SHEET_ACTIVE_SESSION);
  if(!sh){ sh=ss.insertSheet(CFG.SHEET_ACTIVE_SESSION); sh.appendRow(['UID','Nama','Modul','WaktuUpdate']); }
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iUid=headers.indexOf('UID');
  const info=getUserInfo_(body.uid);
  const now=new Date().toISOString();
  let found=false;
  for(let r=1;r<data.length;r++){
    if(String(data[r][iUid])===String(body.uid)){
      sh.getRange(r+1,1,1,4).setValues([[body.uid, info.nama, body.modul||'', now]]);
      found=true; break;
    }
  }
  if(!found) sh.appendRow([body.uid, info.nama, body.modul||'', now]);
  return {ok:true};
}
function handleGetActiveSessions_(p){
  const rows = readSheet_(CFG.SHEET_ACTIVE_SESSION);
  const cutoff = Date.now() - 60000; // anggap tidak aktif jika heartbeat terakhir >60 detik lalu
  const active = rows.filter(r=>{
    const t = new Date(r.WaktuUpdate).getTime();
    return t >= cutoff && String(r.UID)!==String(p.uid); // exclude diri sendiri
  });
  return {ok:true, sessions: active.map(r=>({uid:r.UID, nama:r.Nama, modul:r.Modul}))};
}

/* Isi beberapa aturan awal supaya screening langsung bisa dipakai begitu setup selesai.
   Ini CONTOH DASAR — silakan tim tambah/ubah sesuai kebutuhan lapangan. */
function seedAturanScreeningAwal_(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const shKat=ss.getSheetByName(CFG.SHEET_RULE_KAT);
  if(shKat.getLastRow()<2){
    [['label','Label',''],['filler','Mesin Filler',''],['robotic','Robotic Packer',''],
     ['flexy','Tunggu Mobil Flexi/IBC',''],['ibc','Tunggu Mobil Flexi/IBC','']
    ].forEach(r=>shKat.appendRow(r));
  }
  const shSebab=ss.getSheetByName(CFG.SHEET_RULE_SEBAB);
  if(shSebab.getLastRow()<2){
    [['tunggu','OP','99%'],['perbaikan','TR','96%'],['bocor','TR','94%'],
     ['filling','OP','97%'],['unscramble','TR','98%'],['sampling','OP','100%'],
     ['release','OP','100%'],['flushing','OP','100%']
    ].forEach(r=>shSebab.appendRow(r));
  }
}

/* ============================================================================
   MODUL BARU — KONVERSI RAW SIAP
   ----------------------------------------------------------------------------
   Raw export SIAP asli (kolom: Tgl post, Line, Detail, Sebab, Kategori-kode
   pendek, Awal, Akhir, Durasi) berbeda dari struktur SIAP_DOWNTIME yang dipakai
   backend. Modul ini menjembatani via:
     1. MD_KODE_KATEGORI  — kode pendek (TL/TS/FL) -> nama Kategori resmi.
        Dipakai bareng MD_KLASIFIKASI yang sudah ada untuk dapat Klasifikasi/Big6.
     2. RAW_SIAP_IMPORT   — sheet bantu, admin paste kolom mentah apa adanya
        (Tgl post, Line, Detail, Sebab, Kategori, Durasi) + isi PU/Bulan/Tahun.
     3. konversiRawSIAP_  — logika konversi:
          - Mesin  = Line (raw tidak punya kolom Mesin terpisah)
          - Downtime = Durasi, HANYA untuk baris Durasi > 0
          - OpTime = akumulasi abs(Durasi) untuk baris Durasi <= 0, per Mesin+Tgl
            (durasi negatif/nol = waktu operasi normal yang sudah dikompensasi,
            bukan downtime)
          - Kategori = MD_KODE_KATEGORI[kode]; kode tak dikenal -> "PERLU MAPPING: <kode>"
            + dicatat di log supaya admin sadar dan bisa lengkapi mapping-nya
          - Klasifikasi di-derive dari Kategori via MD_KLASIFIKASI (fallback kosong)
   ============================================================================ */

/* Isi 59 kode kategori yang sudah diketahui, kalau sheet masih kosong.
   Kode yang BELUM ada di sini (misal ditemukan di data lapangan nanti) akan
   otomatis ditandai "PERLU MAPPING" saat convert — tambahkan manual di sheet ini. */
function seedKodeKategoriAwal_(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEET_KODE_KATEGORI);
  if(!sh || sh.getLastRow() > 1) return; // sudah pernah diisi, jangan timpa
  const map = {
    'BCW':'Bottle Check Weigher','CB':'Conveyor Bridge','CE':'Carton Erector','CF':'Change Format',
    'CM':'Conveyor','CP':'Capper','CS':'Carton Sealer','CW':'Carton Weigher','DI':'Devider',
    'DL':'Defect Lubcel','DM':'Defect Material in process (eksternal)','FL':'Flushing','FM':'Bencana',
    'FO':'Foaming','FTR':'Ganti/cek filter bag','IS':'Induction Sealer','IT':'Idle Time','KP':'Kendala Pompa',
    'LB':'Label','LK':'Label karton','LS':'Laser/printer','MD':'Marking Doos','MF':'Mesin Filler',
    'MP':'Minyak Panas/Busa','OR':'Orienter','PL':'Palletizer','PM':'Preventive Maintenance',
    'QH':'QC Incoming material / QC hold','RFL':'Repeat Flushing','RO':'Robotic Packer','RP':'Repack',
    'SB':'Tunggu Sablon','SM':'Setting mesin','SO':'Stock Opname','SP':'Spiral Conveyor',
    'TB':'Tunggu Minyak Blending (koreksi)','TBA':'Tunggu Blending Karena Shortage Aditif',
    'TBD':'Tunggu Proses Bongkar Drum Kosong','TBO':'Tunggu Blending Karena Shortage Base Oil',
    'TD':'Tunggu Dispatch','TE':'Time Out Eksternal','TF':'Tunggu Forklift','TI':'Time Out Internal',
    'TJ':'Tunggu Jalur','TL':'Tunggu Release Lab','TM':'Tunggu Mobil Flexi/IBC',
    'TMI':'Tunggu material akibat internal Filling','TMM':'Tunggu Material dari MWH',
    'TMS':'Tunggu material akibat supplier','TO':'Tunggu Operator','TP':'Tunggu /Selesai program produksi',
    'TPI':'Tunggu Persiapan IBC / Flexi Bag','TPL':'Tunggu PaLLET','TS':'Sampling',
    'TSD':'Tunggu supply drum dari bordes','TT':'Tunggu Personel Teknik','TU':'Utillity',
    'TV':'Tunggu Vendor','UN':'Unscramble',
  };
  const rows = Object.keys(map).map(k=>[k, map[k]]);
  sh.getRange(2,1,rows.length,2).setValues(rows);
}

/* doGet action='get_kode_kategori' -> daftar mapping kode saat ini (buat ditampilkan/diedit di dashboard) */
function handleGetKodeKategori_(p){
  const rows = readSheet_(CFG.SHEET_KODE_KATEGORI);
  return {ok:true, kodeKategori: rows.map(r=>({kode:r.Kode, kategori:r.KategoriResmi}))};
}

/* doPost action='save_kode_kategori' -> body:{kode, kategoriResmi} tambah/update 1 baris mapping */
function handleSaveKodeKategori_(body){
  const {kode, kategoriResmi} = body;
  if(!kode || !kategoriResmi) return {ok:false, error:'kode dan kategoriResmi wajib diisi'};
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName(CFG.SHEET_KODE_KATEGORI);
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iKode=headers.indexOf('Kode'), iKat=headers.indexOf('KategoriResmi');
  const kodeUp = String(kode).trim().toUpperCase();
  for(let r=1;r<data.length;r++){
    if(String(data[r][iKode]).toUpperCase()===kodeUp){
      sh.getRange(r+1, iKat+1).setValue(kategoriResmi);
      return {ok:true, updated:kodeUp};
    }
  }
  sh.appendRow([kodeUp, kategoriResmi]);
  return {ok:true, added:kodeUp};
}

/* doPost action='save_raw_import' -> body:{pu,bulan,tahun,rows:[{tglPost,line,detail,sebab,kategori,durasi}]}
   Menyimpan (append) baris mentah ke RAW_SIAP_IMPORT. Dipakai kalau admin upload xlsx mentah
   lewat dashboard (bukan copy-paste manual ke Sheets). */
function handleSaveRawImport_(body){
  const {pu, bulan, tahun, rows} = body;
  if(!pu || !bulan || !rows || !rows.length) return {ok:false, error:'pu, bulan, dan rows wajib diisi'};
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(CFG.SHEET_RAW_IMPORT);
  if(!sh){ sh=ss.insertSheet(CFG.SHEET_RAW_IMPORT); sh.appendRow(['PU','Bulan','Tahun','Tgl post','Line','Detail','Sebab','Kategori','Durasi']); }
  rows.forEach(r=>{
    sh.appendRow([pu, bulan, tahun||2026, r.tglPost||r.tgl||'', r.line||'', r.detail||'', r.sebab||'', r.kategori||'', r.durasi]);
  });
  return {ok:true, saved:rows.length};
}

/* doPost action='clear_raw_import' -> body:{pu,bulan,tahun} buang semua baris RAW_SIAP_IMPORT
   untuk PU/Bulan/Tahun ini (dipakai setelah convert sukses, supaya sheet bantu tidak menumpuk). */
function handleClearRawImport_(body){
  const {pu, bulan, tahun} = body;
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName(CFG.SHEET_RAW_IMPORT);
  if(!sh) return {ok:true, removed:0};
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const iPU=headers.indexOf('PU'), iBl=headers.indexOf('Bulan'), iTh=headers.indexOf('Tahun');
  const keep=[headers]; let removed=0;
  for(let r=1;r<data.length;r++){
    const row=data[r];
    const match = String(row[iPU])===String(pu) && String(row[iBl])===String(bulan) && String(row[iTh])===String(tahun||2026);
    if(match){ removed++; continue; }
    keep.push(row);
  }
  sh.clearContents();
  sh.getRange(1,1,keep.length,headers.length).setValues(keep);
  return {ok:true, removed};
}

/* doGet action='get_raw_import_status' -> p:{pu,bulan,tahun} jumlah baris RAW_SIAP_IMPORT
   yang menunggu convert untuk PU/Bulan/Tahun ini (ditampilkan sebagai badge di dashboard) */
function handleGetRawImportStatus_(p){
  const rows = readSheet_(CFG.SHEET_RAW_IMPORT).filter(r=>
    String(r.PU)===String(p.pu) && String(r.Bulan)===String(p.bulan) && String(r.Tahun)===String(p.tahun||2026));
  return {ok:true, jumlahBaris: rows.length};
}

/* doPost action='convert_raw_siap' -> body:{pu,bulan,tahun,oleh}
   Menjalankan konversi atas semua baris RAW_SIAP_IMPORT yang cocok, APPEND hasilnya
   ke SIAP_DOWNTIME (tidak menghapus data lama — kalau mau replace penuh sebulan,
   pakai upload_siap seperti biasa setelah convert, atau hapus manual dulu). */
function handleConvertRawSiap_(body){
  const { pu, bulan, tahun, oleh } = body;
  if(!pu || !bulan) return {ok:false, error:'PU & bulan wajib'};
  const result = konversiRawSIAP_(pu, bulan, tahun||2026, oleh||'Tim');
  return Object.assign({ok:true}, result);
}

/* Fungsi inti konversi raw SIAP -> SIAP_DOWNTIME. */
function konversiRawSIAP_(pu, bulan, tahun, oleh){
  const raw = readSheet_(CFG.SHEET_RAW_IMPORT).filter(r=>
    String(r.PU)===String(pu) && String(r.Bulan)===String(bulan) && String(r.Tahun)===String(tahun));
  if(!raw.length) return {converted:0, message:'Tidak ada baris RAW_SIAP_IMPORT yang cocok dengan PU/Bulan/Tahun ini'};

  const kodeMap = {};
  readSheet_(CFG.SHEET_KODE_KATEGORI).forEach(r=>{ if(r.Kode) kodeMap[String(r.Kode).trim().toUpperCase()] = r.KategoriResmi; });

  pastikanKolom_(CFG.SHEET_KLAS, 'Sub');    // migrasi aman: kolom Sub buat mapping Kategori->Sub
  pastikanKolom_(CFG.SHEET_KLAS, 'Fungsi'); // migrasi aman: kolom Fungsi buat mapping Kategori->Fungsi
  const klasMap = {}, subMap = {}, fungsiMap = {}; // Kategori -> Klasifikasi/Sub/Fungsi (dari MD_KLASIFIKASI)
  readSheet_(CFG.SHEET_KLAS).forEach(r=>{
    if(!r.Kategori) return;
    klasMap[r.Kategori] = r.Klasifikasi||'';
    subMap[r.Kategori] = r.Sub||'';
    fungsiMap[r.Kategori] = r.Fungsi||'';
  });

  // --- Pass 1: hitung OpTime per Mesin(Line)+Tgl dari baris Durasi POSITIF ---
  // (dikonfirmasi dari file FIL asli: Durasi negatif = downtime beneran, positif = OpTime)
  const opAgg = {}; // key: Line|Tgl -> total jam
  raw.forEach(r=>{
    const dur = Number(r.Durasi);
    if(isNaN(dur)) return;
    if(dur > 0){
      const key = [r.Line, formatTglRaw_(r['Tgl post'])].join('|');
      opAgg[key] = (opAgg[key]||0) + dur;
    }
  });

  // --- Pass 2: bangun baris SIAP_DOWNTIME untuk Durasi NEGATIF (downtime beneran) ---
  const kodeTidakDikenal = new Set();
  const downtimeRows = [];
  raw.forEach(r=>{
    const dur = Number(r.Durasi);
    if(isNaN(dur) || dur >= 0) return; // durasi>=0 sudah masuk OpTime, bukan downtime

    const kodeAsli = String(r.Kategori||'').trim().toUpperCase();
    let kategoriResmi = kodeMap[kodeAsli];
    if(!kategoriResmi){
      kategoriResmi = 'PERLU MAPPING: ' + (r.Kategori||'?');
      kodeTidakDikenal.add(kodeAsli);
    }
    const klasifikasi = klasMap[kategoriResmi] || '';
    const sub = subMap[kategoriResmi] || '';
    const fungsi = fungsiMap[kategoriResmi] || '';
    const tglFmt = formatTglRaw_(r['Tgl post']);
    const dow = hitungDOW_(r['Tgl post']);

    downtimeRows.push({
      Mesin: r.Line,               // raw tidak punya Mesin terpisah -> pakai Line
      Kategori: kategoriResmi,
      Fungsi: fungsi,
      Sub: sub,
      Downtime: Math.round(Math.abs(dur)*100)/100,
      OpTime: '',                  // OpTime dicatat per Mesin+Tgl terpisah (lihat di bawah), bukan per baris downtime
      LossKL: 0,
      Detail: r.Detail || '',
      Tgl: tglFmt,
      Line: r.Line,
      Shift: '',
      DOW: dow,
      Klasifikasi: klasifikasi,
      Big6: '',
      Sebab: (r.Sebab==='OP'||r.Sebab==='TR') ? r.Sebab : '',
    });
  });

  // --- Tulis ke SIAP_DOWNTIME (append, dengan PU/Bulan/Tahun + RowKey) ---
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let shDt = ss.getSheetByName(CFG.SHEET_SIAP_DT);
  if(!shDt) shDt = ss.insertSheet(CFG.SHEET_SIAP_DT);
  const data = shDt.getDataRange().getValues();
  let headers = data.length ? data[0] : ['PU','Bulan','Tahun','Mesin','Kategori','Fungsi','Sub','Downtime','OpTime','LossKL','Detail','Tgl','Line','Shift','DOW','Klasifikasi','Big6','Sebab','RowKey'];
  if(data.length===0) shDt.appendRow(headers);

  downtimeRows.forEach(o=>{
    o.RowKey = buildRowKey_(pu, bulan, tahun, o);
    shDt.appendRow(headers.map(h=> h==='PU'?pu : h==='Bulan'?bulan : h==='Tahun'?tahun : (o[h]!==undefined?o[h]:'')));
  });

  // --- Tulis OpTime teragregasi ke baris terpisah (1 baris per Mesin+Tgl, Downtime=0) ---
  Object.keys(opAgg).forEach(key=>{
    const [mesin, tgl] = key.split('|');
    shDt.appendRow(headers.map(h=>{
      if(h==='PU') return pu; if(h==='Bulan') return bulan; if(h==='Tahun') return tahun;
      if(h==='Mesin') return mesin; if(h==='Line') return mesin; if(h==='Tgl') return tgl;
      if(h==='OpTime') return Math.round(opAgg[key]*100)/100;
      if(h==='Downtime') return 0;
      if(h==='RowKey') return buildRowKey_(pu,bulan,tahun,{Tgl:tgl,Line:mesin,Kategori:'__OPTIME__',Downtime:0,Detail:'OpTime agregat'});
      return '';
    }));
  });

  // --- Log hasil konversi ---
  let shLog = ss.getSheetByName(CFG.SHEET_KONVERSI_LOG);
  if(!shLog){ shLog = ss.insertSheet(CFG.SHEET_KONVERSI_LOG); shLog.appendRow(['Waktu','PU','Bulan','Tahun','BarisMasuk','BarisJadiDowntime','BarisJadiOpTime','KodeTidakDikenal','Oleh']); }
  shLog.appendRow([new Date().toISOString(), pu, bulan, tahun, raw.length, downtimeRows.length, Object.keys(opAgg).length, [...kodeTidakDikenal].join(', '), oleh]);

  return {
    barisMasuk: raw.length,
    barisJadiDowntime: downtimeRows.length,
    barisJadiOpTime: Object.keys(opAgg).length,
    kodeTidakDikenal: [...kodeTidakDikenal],
    message: kodeTidakDikenal.size
      ? `Konversi selesai, tapi ada ${kodeTidakDikenal.size} kode kategori yang belum dikenal (${[...kodeTidakDikenal].join(', ')}). Baris tsb tetap masuk dengan label "PERLU MAPPING" — lengkapi di MD_KODE_KATEGORI lalu convert ulang, atau perbaiki langsung lewat modul Rekonsiliasi.`
      : 'Konversi selesai, semua kode kategori dikenali.'
  };
}

/* Tgl post bisa berupa Date object (dari paste Excel) atau string "dd/mm" — normalisasi ke 'dd/mm' */
function formatTglRaw_(v){
  if(v instanceof Date && !isNaN(v.getTime())){
    const d = ('0'+v.getDate()).slice(-2), m = ('0'+(v.getMonth()+1)).slice(-2);
    return d+'/'+m;
  }
  // angka serial Excel (kolom ke-format Number, bukan Date, pas di-paste)
  if(typeof v==='number' && isFinite(v) && v>20000 && v<80000){
    const epoch=new Date(Date.UTC(1899,11,30));
    const dt=new Date(epoch.getTime() + v*86400000);
    return formatTglRaw_(dt);
  }
  return String(v||'').trim();
}
/* Format kolom jam (Awal/Akhir) yang bisa datang sebagai Date (Google Sheets time value)
   atau string "HH:MM:SS" -> selalu keluar "HH:MM". */
/* Format kolom jam (Awal/Akhir) yang di export SIAP suka gak konsisten formatnya — bisa Date,
   angka serial/fraksi hari (Excel), teks "HH:MM:SS", "HH.MM", atau "HHMM" tanpa pemisah.
   Selalu divalidasi (jam 0-23, menit 0-59) sebelum diterima; kalau gak masuk akal, teks aslinya
   dikembalikan apa adanya (BUKAN dibuang) supaya tetap kelihatan di Detail Event dan bisa dicek manual. */
function formatJamRaw_(v){
  const valid=(h,mi)=> h>=0 && h<=23 && mi>=0 && mi<=59;
  const pad=n=>('0'+n).slice(-2);

  if(v instanceof Date && !isNaN(v.getTime())){
    const h=v.getHours(), mi=v.getMinutes();
    return valid(h,mi) ? pad(h)+':'+pad(mi) : String(v);
  }
  // angka: bisa fraksi hari (0-1, mis. 0.5=12:00) atau serial tanggal+jam Google Sheets
  if(typeof v==='number' && isFinite(v)){
    const frac=v - Math.floor(v); // ambil bagian jamnya aja, buang tanggalnya
    const totalMin=Math.round(frac*24*60);
    const h=Math.floor(totalMin/60), mi=totalMin%60;
    if(valid(h,mi)) return pad(h)+':'+pad(mi);
  }
  const s=String(v||'').trim();
  if(!s) return '';
  // "HH:MM" atau "HH:MM:SS" atau "HH.MM"
  let m=s.match(/^(\d{1,2})[:.](\d{2})/);
  if(m){ const h=Number(m[1]), mi=Number(m[2]); if(valid(h,mi)) return pad(h)+':'+pad(mi); }
  // "HHMM" 4 digit tanpa pemisah (mis. "2050")
  m=s.match(/^(\d{2})(\d{2})$/);
  if(m){ const h=Number(m[1]), mi=Number(m[2]); if(valid(h,mi)) return pad(h)+':'+pad(mi); }
  // gak kekenali sama sekali -> kembalikan teks aslinya, jangan dibuang
  return s;
}
function hitungDOW_(v){
  if(v instanceof Date) return v.getDay();
  return '';
}

/* ============================================================================
   ===== BARU — 4 SHEET RAW BULANAN (paste manual) + SYNC KE DASHBOARD ======
   ----------------------------------------------------------------------------
   Alur: (1) jalankan setupRawBulananSheets() SEKALI di awal -> 4 sheet baru
   dibuat, header PERSIS sama seperti kolom di file SIAP asli (Hasil Produksi,
   Downtime, Pemakaian, Net Op) + 1 kolom PU tambahan di depan.
   (2) Paste data mentah SIAP langsung ke sheet-sheet itu (mulai baris 2, header
   jangan diubah). Boleh isi salah satu/sebagian dulu, sisanya nanti nyusul.
   (3) Jalankan syncRawBulananSemua() -> otomatis mendeteksi semua kombinasi
   PU+Bulan+Tahun yang ada di 4 sheet raw, convert, lalu REPLACE data bulan itu
   di SIAP_DOWNTIME/SIAP_HASILPROD/SIAP_NETOP/SIAP_PEMAKAIAN (sheet yang sudah
   dipakai dashboard/HTML selama ini — jadi HTML tidak perlu diubah sama sekali).
   Aman dijalankan berkali-kali: replace per PU+Bulan+Tahun, bukan menumpuk baris.
   ============================================================================ */

/* Menu custom di Google Sheets supaya Bagus tinggal klik, tidak perlu buka editor Apps Script. */
function onOpen(){
  SpreadsheetApp.getUi().createMenu('⚙️ OPS HUB')
    .addItem('1) Siapkan 4 Sheet Raw Bulanan (sekali di awal)', 'setupRawBulananSheets')
    .addItem('2) 🔄 Sync Raw Bulanan → Dashboard', 'syncRawBulananSemua')
    .addItem('3) Siapkan Sheet Mitigasi/Action Tracking (sekali di awal)', 'setupMitigasiSheets')
    .addItem('4) Isi Mapping Kategori→Sub→Fungsi Default (sekali di awal)', 'seedMappingKategoriDefault')
    .addSeparator()
    .addItem('⚠️ Kosongkan Data SIAP Lama (mulai dari nol)', 'kosongkanDataSiapLama')
    .addToUi();
}

/* Hapus PERMANEN semua data (baris 2 dst) di SIAP_DOWNTIME/SIAP_HASILPROD/SIAP_NETOP/SIAP_PEMAKAIAN,
   header baris 1 tetap disisakan. Ada konfirmasi popup dulu karena ini destructive & gak bisa di-undo. */
function kosongkanDataSiapLama(){
  const ui=SpreadsheetApp.getUi();
  const resp=ui.alert('⚠️ Konfirmasi Hapus Data',
    'Ini akan MENGHAPUS PERMANEN semua isi data di sheet:\n\n- SIAP_DOWNTIME\n- SIAP_HASILPROD\n- SIAP_NETOP\n- SIAP_PEMAKAIAN\n\n(header baris 1 tetap ada, cuma datanya yang kosong). Aksi ini TIDAK BISA di-undo. Yakin lanjut?',
    ui.ButtonSet.YES_NO);
  if(resp!==ui.Button.YES){ ui.alert('Dibatalkan, data tidak diubah.'); return; }
  const targets=[CFG.SHEET_SIAP_DT, CFG.SHEET_SIAP_HP, CFG.SHEET_SIAP_NETOP, CFG.SHEET_SIAP_PMK];
  const dikosongkan=[];
  targets.forEach(name=>{
    const sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if(!sh) return;
    const lastRow=sh.getLastRow(), lastCol=Math.max(sh.getLastColumn(),1);
    if(lastRow>1){ sh.getRange(2,1,lastRow-1,lastCol).clearContent(); dikosongkan.push(name); }
  });
  ui.alert(dikosongkan.length
    ? ('✓ Data lama sudah dikosongkan di: '+dikosongkan.join(', ')+'.\n\nSekarang tinggal isi 4 sheet RAW_BULANAN_* dari nol, lalu jalankan "🔄 Sync Raw Bulanan → Dashboard".')
    : 'Tidak ada sheet SIAP_* yang ditemukan atau semuanya sudah kosong.');
}

/* Bikin 4 sheet raw kalau belum ada. TIDAK clearContents kalau sheet sudah ada,
   supaya aman dijalankan ulang tanpa menghapus data yang sudah dipaste. */
function setupRawBulananSheets(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const defs={
    [CFG.SHEET_RAW_HP]:    ['PU','#','Tgl post','Tipe','Line','Kimap','Produk','Ukuran','Batch Filling','Jumlah','Jumlah Bulk','Hari','Bulan','Tahun'],
    [CFG.SHEET_RAW_DT]:    ['PU','#','Tgl post','Line','Kimap','Produk','Batch Filling','Detail','Solusi','Sebab','Kategori','Awal','Akhir','Durasi','Hari','Bulan','Tahun'],
    [CFG.SHEET_RAW_PMK]:   ['PU','#','Tgl post','Kimap','Produk','Batch Filling','Material','Deskripsi','Batch','Sloc','Jumlah','Reject','Hari','Bulan','Tahun'],
    [CFG.SHEET_RAW_NETOP]: ['PU','net_op_id','tanggal','line','shift','durasi','Hari','Bulan','Tahun'],
  };
  const dibuat=[];
  Object.keys(defs).forEach(name=>{
    let sh=ss.getSheetByName(name);
    if(!sh){
      sh=ss.insertSheet(name);
      sh.getRange(1,1,1,defs[name].length).setValues([defs[name]]);
      sh.setFrozenRows(1);
      dibuat.push(name);
    }
  });
  SpreadsheetApp.getUi().alert(dibuat.length
    ? ('✓ Sheet raw bulanan dibuat:\n\n'+dibuat.join('\n')+'\n\nHeader-nya PERSIS sama seperti kolom di file SIAP asli (ditambah 1 kolom PU di depan, isi PUJ/PUC/PUG). Tinggal paste data mentah mulai baris 2 (header jangan diubah/geser), lalu jalankan menu "🔄 Sync Raw Bulanan → Dashboard".')
    : 'Ke-4 sheet raw bulanan sudah ada semua, tidak ada yang dibuat ulang (supaya data yang sudah lo paste tidak ke-reset).');
}

/* Deteksi otomatis semua kombinasi PU+Bulan+Tahun yang ada di 4 sheet raw
   (dari kolom tanggal masing-masing), lalu sync satu-satu. */
/* Core logic sync — TIDAK pakai SpreadsheetApp.getUi() supaya bisa dipanggil dari doPost (tombol di
   dashboard web) maupun dari menu Sheets. Return {ok, keys, ringkasan[]} sebagai data, bukan alert. */
function syncRawBulananCore_(){
  pastikanKolom_(CFG.SHEET_SIAP_DT, 'Produk'); // migrasi aman: tambah kolom Produk kalau sheet lama belum punya
  pastikanKolom_(CFG.SHEET_SIAP_DT, 'Batch');  // migrasi aman: tambah kolom Batch kalau sheet lama belum punya
  ['Kimap','Solusi','Awal','Akhir'].forEach(k=>pastikanKolom_(CFG.SHEET_SIAP_DT, k));
  // migrasi aman: kolom Hari/Bulan/Tahun manual di 4 sheet raw -- opsional, dipakai duluan
  // kalau diisi (gak ambigu sama sekali), fallback ke parsing Tgl post/tanggal kalau kosong.
  [CFG.SHEET_RAW_HP, CFG.SHEET_RAW_DT, CFG.SHEET_RAW_PMK, CFG.SHEET_RAW_NETOP].forEach(nm=>{
    ['Hari','Bulan','Tahun'].forEach(k=>pastikanKolom_(nm,k));
  });
  seedMappingKategoriDefault(); // pastikan mapping Kategori->Sub->Fungsi lengkap sebelum sync (aman, idempotent)
  const combos={};
  const gagal={}; // sheetName -> [{row, nilai}, ...] baris yang PU-nya keisi tapi tanggalnya gagal dibaca
  const kumpulkan=(sheetName, tglField)=>{
    const list=[];
    readSheetWithRow_(sheetName).forEach(r=>{
      const pu=String(r.PU||'').trim(); if(!pu) return;
      const d=resolveBulanTahun_(r, tglField);
      if(!d){ list.push({row:r._row, nilai:String(r[tglField])}); return; }
      combos[[pu,d.bulan,d.tahun].join('|')] = {pu, bulan:d.bulan, tahun:d.tahun};
    });
    if(list.length) gagal[sheetName]=list;
  };
  kumpulkan(CFG.SHEET_RAW_HP,    'Tgl post');
  kumpulkan(CFG.SHEET_RAW_DT,    'Tgl post');
  kumpulkan(CFG.SHEET_RAW_PMK,   'Tgl post');
  kumpulkan(CFG.SHEET_RAW_NETOP, 'tanggal');

  const fmtGagal=()=>Object.entries(gagal).map(([sheet,list])=>
    `${sheet}: baris ${list.slice(0,10).map(x=>x.row+' ("'+x.nilai+'")').join(', ')}${list.length>10?' … +'+(list.length-10)+' baris lagi':''}`
  ).join('\n');

  const keys=Object.keys(combos);
  if(!keys.length){
    let err='Belum ada data yang bisa disync. Pastikan kolom PU dan kolom tanggal (Tgl post / tanggal) di 4 sheet RAW_BULANAN_* sudah terisi.';
    if(Object.keys(gagal).length) err += '\n\n⚠ Baris yang tanggalnya gagal dibaca (PERBAIKI dulu, ini TIDAK ikut ke-sync):\n' + fmtGagal();
    return {ok:false, error:err};
  }

  const ringkasan=keys.map(k=>{
    const {pu,bulan,tahun}=combos[k];
    const r=syncRawBulananSatu_(pu,bulan,tahun);
    if(r.durasiGagal && r.durasiGagal.length){
      gagal[CFG.SHEET_RAW_DT+' (kolom Durasi, '+pu+' '+bulan+'/'+tahun+')'] = r.durasiGagal;
    }
    return `${pu} ${bulan}/${tahun} → Hasil Produksi ${r.hasilProd}, Downtime ${r.downtime}, Pemakaian ${r.pemakaian}, Net Op ${r.netOp}`;
  });
  if(Object.keys(gagal).length){
    ringkasan.push('⚠ PERHATIAN — baris berikut TIDAK ikut ke-sync karena tanggalnya gak kebaca (perbaiki manual lalu sync ulang):\n' + fmtGagal());
  }
  return {ok:true, n:keys.length, ringkasan, adaGagal:Object.keys(gagal).length>0};
}

/* Dipanggil dari menu Sheets ("⚙️ OPS HUB") — pakai popup alert biasa. */
function syncRawBulananSemua(){
  const ui=SpreadsheetApp.getUi();
  const res=syncRawBulananCore_();
  if(!res.ok){ ui.alert(res.error); return; }
  ui.alert('✓ Sync selesai untuk '+res.n+' kombinasi PU/Bulan/Tahun:\n\n'+res.ringkasan.join('\n'));
}

/* Dipanggil dari tombol di dashboard web (doPost action:'sync_raw_bulanan') — admin only. */
function handleSyncRawBulanan_(body){
  if(!isAdmin_(body.uid)) return {ok:false, error:'Cuma admin yang boleh menjalankan sync dari dashboard.'};
  return syncRawBulananCore_();
}

/* Isi MD_KLASIFIKASI dengan mapping referensi Kategori->Sub->Fungsi->Klasifikasi (59 kategori umum,
   dari hasil analisis Mapping_Table di workbook KPI Downtime asli). AMAN dijalankan berkali-kali:
   cuma NAMBAH baris buat Kategori yang belum ada, gak pernah nimpa/hapus baris yang udah ada
   (kalau lo udah custom suatu Kategori, itu gak disentuh). */
function seedMappingKategoriDefault(){
  const DEFAULT_MAP=[
    ['Bencana','Internal PU','Production','Eksternal'],
    ['Bottle Check Weigher','Trouble Mesin','Technical Services','Breakdown'],
    ['Capper','Trouble Mesin','Technical Services','Breakdown'],
    ['Carton Erector','Operasional Mesin','Production','Breakdown'],
    ['Carton Sealer','Trouble Mesin','Technical Services','Breakdown'],
    ['Carton Weigher','Trouble Mesin','Technical Services','Breakdown'],
    ['Change Format','Internal PU','Production','Setup'],
    ['Conveyor','Trouble Mesin','Technical Services','Breakdown'],
    ['Conveyor Bridge','Operasional Mesin','Production','Breakdown'],
    ['Defect Lubcel','Trouble Mesin','Technical Services','Quality'],
    ['Defect Material in process (eksternal)','Quality-Inspection','Quality Assurance','Quality'],
    ['Devider','Trouble Mesin','Technical Services','Breakdown'],
    ['Flushing','Internal PU','Production','Setup'],
    ['Foaming','Internal PU','Production','Breakdown'],
    ['Ganti/cek filter bag','Internal PU','Production','Setup'],
    ['Idle Time','Idle Time Non-Kategori','Idle Time Non-Kategori','Waiting'],
    ['Induction Sealer','Trouble Mesin','Technical Services','Breakdown'],
    ['Kendala Pompa','Trouble Mesin','Technical Services','Breakdown'],
    ['Label','Trouble Mesin','Technical Services','Breakdown'],
    ['Label karton','Operasional Mesin','Production','Breakdown'],
    ['Laser/printer','Operasional Mesin','Production','Breakdown'],
    ['Marking Doos','Trouble Mesin','Technical Services','Breakdown'],
    ['Mesin Filler','Trouble Mesin','Technical Services','Breakdown'],
    ['Minyak Panas/Busa','Internal PU','Production','Breakdown'],
    ['Orienter','Trouble Mesin','Technical Services','Breakdown'],
    ['Palletizer','Trouble Mesin','Technical Services','Breakdown'],
    ['Preventive Maintenance','Trouble Mesin','Technical Services','Setup'],
    ['QC Incoming material / QC hold','Internal PU','Production','Quality'],
    ['Repack','Internal PU','Production','Setup'],
    ['Repeat Flushing','Internal PU','Production','Setup'],
    ['Robotic Packer','Trouble Mesin','Technical Services','Breakdown'],
    ['Sampling','Quality-Lab','Quality Assurance','Setup'],
    ['Setting mesin','Internal PU','Production','Setup'],
    ['Stock Opname','Internal PU','Production','Waiting'],
    ['Time Out Eksternal','Internal PU','Production','Waiting'],
    ['Time Out Internal','Internal PU','Production','Waiting'],
    ['Tunggu /Selesai program produksi','Internal PU','Production','Waiting'],
    ['Tunggu Blending Karena Shortage Aditif','Production RMP','Production','Waiting'],
    ['Tunggu Blending Karena Shortage Base Oil','Production RMP','Production','Waiting'],
    ['Tunggu Dispatch','Distribusi','Distribution','Waiting'],
    ['Tunggu Forklift','Internal PU','Production','Waiting'],
    ['Tunggu Jalur','Internal PU','Production','Waiting'],
    ['Tunggu Material dari MWH','Internal PU','Production','Waiting'],
    ['Tunggu Minyak Blending (koreksi)','Internal PU','Production','Waiting'],
    ['Tunggu Mobil Flexi/IBC','Internal PU','Production','Waiting'],
    ['Tunggu Operator','Internal PU','Production','Waiting'],
    ['Tunggu PaLLET','Distribusi','Distribution','Waiting'],
    ['Tunggu Persiapan IBC / Flexi Bag','Internal PU','Production','Waiting'],
    ['Tunggu Personel Teknik','Trouble Mesin','Technical Services','Waiting'],
    ['Tunggu Release Lab','Quality-Lab','Quality Assurance','Waiting'],
    ['Tunggu Sablon','Internal PU','Production','Waiting'],
    ['Tunggu Vendor','Internal PU','Production','Waiting'],
    ['Tunggu material akibat internal FIlling','Internal PU','Production','Waiting'],
    ['Tunggu material akibat supplier','Production RMP','Production','Waiting'],
    ['Tunggu supply drum dari bordes','Internal PU','Production','Waiting'],
    ['Unscramble','Trouble Mesin','Technical Services','Breakdown'],
    ['Utillity','Trouble Mesin','Technical Services','Eksternal'],
    ['blank/operator lupa isi kategori','blank/operator lupa isi kategori','Production','Breakdown'],
    ['start-end produksi','start-end produksi','Production','Setup'],
  ];
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(CFG.SHEET_KLAS);
  if(!sh){ sh=ss.insertSheet(CFG.SHEET_KLAS); sh.getRange(1,1,1,3).setValues([['Kategori','Klasifikasi','Sub']]); sh.setFrozenRows(1); }
  pastikanKolom_(CFG.SHEET_KLAS, 'Sub');
  pastikanKolom_(CFG.SHEET_KLAS, 'Fungsi');
  const existing=new Set(readSheet_(CFG.SHEET_KLAS).map(r=>String(r.Kategori||'').trim()).filter(Boolean));
  const header=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const iKat=header.indexOf('Kategori'), iKlas=header.indexOf('Klasifikasi'), iSub=header.indexOf('Sub'), iFungsi=header.indexOf('Fungsi');
  const ditambah=[];
  DEFAULT_MAP.forEach(([kat,sub,fungsi,klas])=>{
    if(existing.has(kat)) return; // udah ada (mungkin dicustom user), jangan disentuh
    const row=new Array(Math.max(iKat,iKlas,iSub,iFungsi)+1).fill('');
    row[iKat]=kat; row[iKlas]=klas; row[iSub]=sub; row[iFungsi]=fungsi;
    sh.appendRow(row);
    ditambah.push(kat);
  });
  if(typeof SpreadsheetApp.getUi==='function'){
    try{
      SpreadsheetApp.getUi().alert(ditambah.length
        ? ('✓ '+ditambah.length+' kategori referensi ditambahkan ke MD_KLASIFIKASI:\n\n'+ditambah.slice(0,15).join(', ')+(ditambah.length>15?' … +'+(ditambah.length-15)+' lagi':''))
        : 'Semua 59 kategori referensi sudah ada di MD_KLASIFIKASI, tidak ada yang ditambahkan.');
    }catch(e){}
  }
  return {ditambah:ditambah.length};
}
/* Pastikan sebuah sheet punya kolom tertentu di header row; kalau belum ada,
   ditambahkan sebagai kolom baru di akhir (data lama otomatis kosong di kolom itu).
   Aman dipanggil berkali-kali — tidak menyentuh data yang sudah ada. */
function pastikanKolom_(sheetName, namaKolom){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName(sheetName);
  if(!sh) return;
  const lastCol=Math.max(sh.getLastColumn(),1);
  const header=sh.getRange(1,1,1,lastCol).getValues()[0].map(String);
  if(header.indexOf(namaKolom)===-1){
    sh.getRange(1,lastCol+1).setValue(namaKolom);
  }
}

/* Sync 1 kombinasi PU+Bulan+Tahun: baca baris yang cocok dari ke-4 sheet raw,
   convert ke skema SIAP_* yang sudah dipakai dashboard, lalu REPLACE (bukan
   append) data bulan itu di SIAP_HASILPROD/SIAP_PEMAKAIAN/SIAP_NETOP/SIAP_DOWNTIME. */
/* Parse angka fleksibel — data yang diketik/paste manual suka pakai koma sebagai desimal
   ("0,5" gaya Indonesia) padahal JS butuh titik. Coba angka apa adanya dulu, baru coba ganti
   koma->titik. Return null (bukan NaN) kalau beneran gak kebaca, supaya gampang dicek falsy. */
function parseAngkaFleksibel_(v){
  if(typeof v==='number' && isFinite(v)) return v;
  const s=String(v==null?'':v).trim();
  if(s==='') return null;
  let n=Number(s);
  if(!isNaN(n)) return n;
  n=Number(s.replace(/\./g,'').replace(',','.')); // format Indonesia: "1.234,5" -> "1234.5"
  if(!isNaN(n)) return n;
  n=Number(s.replace(',','.')); // simple: "0,5" -> "0.5"
  return isNaN(n) ? null : n;
}

function syncRawBulananSatu_(pu, bulan, tahun){
  // --- Hasil Produksi ---
  const hpRows = readSheet_(CFG.SHEET_RAW_HP)
    .filter(r=>cocokPuBulan_(r,'Tgl post',pu,bulan,tahun))
    .map(r=>({Tipe:r['Tipe']||'', Line:r['Line']||'', Kimap:r['Kimap']||'', Produk:r['Produk']||'', Ukuran:r['Ukuran']||'', Jumlah:parseAngkaFleksibel_(r['Jumlah'])||0, Reject:0}));
  replaceMonthData_(CFG.SHEET_SIAP_HP, pu, bulan, tahun, hpRows);

  // --- Pemakaian ---
  const pmkRows = readSheet_(CFG.SHEET_RAW_PMK)
    .filter(r=>cocokPuBulan_(r,'Tgl post',pu,bulan,tahun))
    .map(r=>({Material:r['Material']||'', Deskripsi:r['Deskripsi']||'', Reject:parseAngkaFleksibel_(r['Reject'])||0}));
  replaceMonthData_(CFG.SHEET_SIAP_PMK, pu, bulan, tahun, pmkRows);

  // --- Net Op ---
  const netOpRows = readSheet_(CFG.SHEET_RAW_NETOP)
    .filter(r=>cocokPuBulan_(r,'tanggal',pu,bulan,tahun))
    .map(r=>({Line:r['line']||'', Tanggal:bangunTglTampilan_(r,'tanggal'), NetOp:parseAngkaFleksibel_(r['durasi'])||0}));
  replaceMonthData_(CFG.SHEET_SIAP_NETOP, pu, bulan, tahun, netOpRows);

  // --- Downtime (dikonfirmasi dari file FIL asli & kolom Downtime/Operation Time-nya:
  //     Durasi NEGATIF = downtime beneran (pakai abs-nya), Durasi POSITIF = OpTime.
  //     Kode Kategori pendek dipetakan via MD_KODE_KATEGORI; Sub & Fungsi dipetakan via MD_KLASIFIKASI) ---
  pastikanKolom_(CFG.SHEET_KLAS, 'Sub');    // migrasi aman: kolom Sub buat mapping Kategori->Sub
  pastikanKolom_(CFG.SHEET_KLAS, 'Fungsi'); // migrasi aman: kolom Fungsi buat mapping Kategori->Fungsi
  const dtRaw = readSheetWithRow_(CFG.SHEET_RAW_DT).filter(r=>cocokPuBulan_(r,'Tgl post',pu,bulan,tahun));
  const kodeMap={}; readSheet_(CFG.SHEET_KODE_KATEGORI).forEach(r=>{ if(r.Kode) kodeMap[String(r.Kode).trim().toUpperCase()]=r.KategoriResmi; });
  const klasMap={}, subMap={}, fungsiMap={};
  readSheet_(CFG.SHEET_KLAS).forEach(r=>{
    if(!r.Kategori) return;
    klasMap[r.Kategori]=r.Klasifikasi||'';
    subMap[r.Kategori]=r.Sub||'';
    fungsiMap[r.Kategori]=r.Fungsi||'';
  });

  const durasiGagal=[]; // {row, nilai} — Durasi gak kebaca sebagai angka sama sekali

  const opAgg={};
  dtRaw.forEach(r=>{
    const dur=parseAngkaFleksibel_(r['Durasi']);
    if(dur==null){ durasiGagal.push({row:r._row, nilai:String(r['Durasi'])}); return; }
    if(dur>0){ const key=[r['Line'], bangunTglTampilan_(r,'Tgl post')].join('|'); opAgg[key]=(opAgg[key]||0)+dur; }
  });

  const downtimeRows=[];
  dtRaw.forEach(r=>{
    const dur=parseAngkaFleksibel_(r['Durasi']);
    if(dur==null||dur>=0) return; // dur>=0 = OpTime/gagal parse, bukan downtime; yang gagal udah dicatat di durasiGagal
    const kodeAsli=String(r['Kategori']||'').trim().toUpperCase();
    let kategoriResmi = kodeAsli ? (kodeMap[kodeAsli] || ('PERLU MAPPING: '+r['Kategori'])) : '';
    const klasifikasi = klasMap[kategoriResmi]||'';
    const sub = subMap[kategoriResmi]||'';
    const fungsi = fungsiMap[kategoriResmi]||'';
    downtimeRows.push({
      Mesin:r['Line']||'', Kategori:kategoriResmi, Fungsi:fungsi, Sub:sub,
      Downtime:Math.round(Math.abs(dur)*100)/100, OpTime:'', LossKL:0,
      Detail:r['Detail']||'', Tgl:bangunTglTampilan_(r,'Tgl post'), Line:r['Line']||'', Shift:'',
      DOW:hitungDOWTampilan_(r,'Tgl post'), Klasifikasi:klasifikasi, Big6:'',
      Sebab:(r['Sebab']==='OP'||r['Sebab']==='TR') ? r['Sebab'] : '',
      Produk:r['Produk']||'', Batch:r['Batch Filling']||'',
      Kimap:r['Kimap']||'', Solusi:r['Solusi']||'', Awal:formatJamRaw_(r['Awal']), Akhir:formatJamRaw_(r['Akhir']),
    });
  });
  Object.keys(opAgg).forEach(key=>{
    const [mesin,tgl]=key.split('|');
    downtimeRows.push({Mesin:mesin, Kategori:'', Fungsi:'', Sub:'', Downtime:0, OpTime:Math.round(opAgg[key]*100)/100, LossKL:0, Detail:'OpTime agregat', Tgl:tgl, Line:mesin, Shift:'', DOW:'', Klasifikasi:'', Big6:'', Sebab:''});
  });
  downtimeRows.forEach(o=>{ o.RowKey = buildRowKey_(pu,bulan,tahun,o); });
  replaceMonthData_(CFG.SHEET_SIAP_DT, pu, bulan, tahun, downtimeRows);

  return {hasilProd:hpRows.length, downtime:downtimeRows.length, pemakaian:pmkRows.length, netOp:netOpRows.length, durasiGagal};
}

/* Cek 1 baris raw cocok PU+Bulan+Tahun tertentu (tanggal dibaca dari tglField). */
function cocokPuBulan_(row, tglField, pu, bulan, tahun){
  if(String(row.PU||'').trim() !== String(pu)) return false;
  const d=resolveBulanTahun_(row, tglField);
  return !!d && d.bulan===Number(bulan) && d.tahun===Number(tahun);
}

/* Ambil {bulan,tahun} dari 1 baris raw. Prioritas: kolom manual Hari/Bulan/Tahun (kalau
   Bulan+Tahun keisi angka valid) -- ini SUMBER PALING AKURAT karena diketik langsung,
   gak ada ambiguitas dd/mm vs mm/dd sama sekali. Fallback ke parsing kolom tanggal
   teks/Date (tglField) lewat parseTglFleksibel_ kalau Bulan/Tahun manual belum diisi
   (supaya data lama yang formatnya udah kebukti bener, mis. yyyy-mm-dd, gak usah diubah). */
function resolveBulanTahun_(row, tglField){
  const bManual=Number(row['Bulan']), tManual=Number(row['Tahun']);
  if(bManual>=1 && bManual<=12 && tManual>=2015 && tManual<=2035) return {bulan:bManual, tahun:tManual};
  return parseTglFleksibel_(row[tglField]);
}

/* Bangun tampilan tanggal "dd/mm" buat baris Downtime/NetOp -- prioritas kolom manual
   Hari+Bulan (gak ambigu), fallback ke parsing tglField (Date/teks) seperti sebelumnya. */
function bangunTglTampilan_(row, tglField){
  const hari=Number(row['Hari']), bulan=Number(row['Bulan']);
  if(hari>=1 && hari<=31 && bulan>=1 && bulan<=12){
    const pad=n=>('0'+n).slice(-2);
    return pad(hari)+'/'+pad(bulan);
  }
  return formatTglRaw_(row[tglField]);
}

/* Hari dalam minggu (0=Minggu..6=Sabtu) -- prioritas kolom manual Hari/Bulan/Tahun,
   fallback ke hitungDOW_ (butuh Date object asli) kalau manual belum diisi. */
function hitungDOWTampilan_(row, tglField){
  const hari=Number(row['Hari']), bulan=Number(row['Bulan']), tahun=Number(row['Tahun']);
  if(hari>=1 && hari<=31 && bulan>=1 && bulan<=12 && tahun>=2015){
    return new Date(tahun, bulan-1, hari).getDay();
  }
  return hitungDOW_(row[tglField]);
}

/* Parse tanggal fleksibel: Date object (dari paste Excel), "dd/mm/yyyy", atau "dd/mm"
   (asumsi tahun berjalan kalau tahun tidak ada di string). */
/* Parse tanggal SUPER fleksibel — data ekspor SIAP sering gak konsisten formatnya (kadang Date asli,
   kadang teks "dd/mm/yyyy", kadang angka serial Excel, kadang ada nama bulan). Fungsi ini nyoba semua
   kemungkinan, tapi SELALU validasi hasil akhir (bulan 1-12, tahun masuk akal) sebelum diterima —
   kalau gak masuk akal, return null (baris itu di-skip) daripada ngasih angka ngaco yang bikin
   tombol periode di dashboard jadi "undefined". */
function parseTglFleksibel_(v){
  const valid=(bulan,tahun)=> bulan>=1 && bulan<=12 && tahun>=2015 && tahun<=2035;

  // 1) Date object asli (paling umum kalau kolom di-format sebagai tanggal di Sheets)
  if(v instanceof Date && !isNaN(v.getTime())){
    const bulan=v.getMonth()+1, tahun=v.getFullYear();
    return valid(bulan,tahun) ? {bulan,tahun} : null;
  }

  // 2) Angka serial Excel/Sheets (kolom ke-format General/Number, bukan Date, pas di-paste)
  if(typeof v==='number' && isFinite(v) && v>20000 && v<80000){
    const epoch=new Date(Date.UTC(1899,11,30));
    const d=new Date(epoch.getTime() + v*86400000);
    const bulan=d.getUTCMonth()+1, tahun=d.getUTCFullYear();
    return valid(bulan,tahun) ? {bulan,tahun} : null;
  }

  const s=String(v||'').trim();
  if(!s) return null;

  // 3) Angka serial yang kebaca sebagai teks (mis. "45678")
  if(/^\d{5}$/.test(s)) return parseTglFleksibel_(Number(s));

  // 4) "dd/mm/yyyy", "dd-mm-yyyy", "yyyy-mm-dd", dst — angka semua, dipisah / atau -
  let m=s.match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})$/);
  if(m){
    let a=Number(m[1]), b=Number(m[2]), c=Number(m[3]);
    // deteksi yyyy-mm-dd (bagian pertama 4 digit)
    if(String(m[1]).length===4){
      const tahun=a, bulan=b; // sisanya (c) = hari, diabaikan
      if(valid(bulan,tahun)) return {bulan,tahun};
    }
    // dd/mm/yyyy (format Indonesia, default)
    let tahun=c<100?c+2000:c;
    if(valid(b,tahun)) return {bulan:b, tahun}; // b=bulan, langsung valid
    // fallback: kalau bulan(b) gak valid tapi a valid sebagai bulan -> berarti ketuker mm/dd/yyyy
    if(valid(a,tahun)) return {bulan:a, tahun};
    return null;
  }

  // 5) "dd/mm" atau "dd-mm" tanpa tahun (asumsi tahun berjalan)
  m=s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if(m){
    const tahun=new Date().getFullYear();
    const a=Number(m[1]), b=Number(m[2]);
    if(valid(b,tahun)) return {bulan:b, tahun};
    if(valid(a,tahun)) return {bulan:a, tahun}; // ketuker mm/dd
    return null;
  }

  // 6) Format dengan nama bulan: "5 Januari 2026", "05-Jan-2026", "Jan 2026", dst
  const NAMA_BULAN={jan:1,feb:2,mar:3,apr:4,mei:5,may:5,jun:6,jul:7,agu:8,ags:8,aug:8,sep:9,sept:9,okt:10,oct:10,nov:11,des:12,dec:12};
  const lower=s.toLowerCase();
  for(const key in NAMA_BULAN){
    if(new RegExp('(^|[^a-z])'+key+'([^a-z]|$)').test(lower)){
      const th=lower.match(/(20\d{2})/);
      const tahun=th?Number(th[1]):new Date().getFullYear();
      const bulan=NAMA_BULAN[key];
      if(valid(bulan,tahun)) return {bulan,tahun};
      break;
    }
  }
  return null;
}

/* ============================================================================
   ===== BARU — MITIGASI / ACTION TRACKING ==================================
   ----------------------------------------------------------------------------
   Konsep: setiap Fungsi (bukan cuma PE) punya action item buat mitigasi
   downtime yang jadi tanggung jawabnya. Action bisa umum per Fungsi/Kategori,
   atau nempel ke kejadian downtime spesifik (via LinkedRowKey, dari tabel
   Detail Event / Repeat Offender). Tiap perubahan status tercatat di
   MITIGASI_LOG (histori), dan evidence (foto/dokumen) bisa diupload langsung
   (disimpan ke folder Drive) atau cukup tempel link yang udah ada.
   Yang boleh UPDATE status / tambah evidence: PIC yang ditugaskan di action
   itu, atau admin. Siapa saja yang login boleh MEMBUAT action baru.
   ============================================================================ */

/* Bikin 2 sheet mitigasi kalau belum ada. Aman dipanggil berkali-kali. */
function setupMitigasiSheets(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const defs={
    [CFG.SHEET_MITIGASI]:[
      'ActionID','PU','Fungsi','Kategori','Bulan','Tahun','Judul','Deskripsi','PIC','Status',
      'TargetSelesai','Support','EvidenceLinks','LinkedRowKey','DibuatOleh','TanggalDibuat',
      'TerakhirUpdate','TerakhirUpdateOleh'
    ],
    [CFG.SHEET_MITIGASI_LOG]:['LogID','ActionID','Waktu','Oleh','StatusLama','StatusBaru','Catatan'],
  };
  const dibuat=[];
  Object.keys(defs).forEach(name=>{
    let sh=ss.getSheetByName(name);
    if(!sh){
      sh=ss.insertSheet(name);
      sh.getRange(1,1,1,defs[name].length).setValues([defs[name]]);
      sh.setFrozenRows(1);
      dibuat.push(name);
    }
  });
  if(typeof SpreadsheetApp.getUi==='function'){
    try{
      SpreadsheetApp.getUi().alert(dibuat.length
        ? ('✓ Sheet mitigasi dibuat:\n\n'+dibuat.join('\n'))
        : 'Sheet mitigasi sudah ada semua, tidak ada yang dibuat ulang.');
    }catch(e){/* dipanggil dari konteks tanpa UI (mis. doGet) — abaikan */}
  }
}

/* Cek apakah uid boleh update/upload evidence ke action tertentu:
   admin selalu boleh; selain itu harus PIC yang ditugaskan di action ini. */
function canEditActionMitigasi_(action, uid){
  if(isAdmin_(uid)) return true;
  return String(action.PIC||'').trim().toLowerCase() === String(uid||'').trim().toLowerCase();
}

function handleGetActionsMitigasi_(p){
  setupMitigasiSheets();
  let actions=readSheet_(CFG.SHEET_MITIGASI);
  let log=readSheet_(CFG.SHEET_MITIGASI_LOG);
  if(p.pu) actions=actions.filter(a=>String(a.PU)===String(p.pu));
  if(p.bulan) actions=actions.filter(a=>String(a.Bulan)===String(p.bulan));
  if(p.tahun) actions=actions.filter(a=>String(a.Tahun)===String(p.tahun));
  actions.forEach(a=>{ a.canEdit = canEditActionMitigasi_(a, p.uid); });
  return {ok:true, actions, log};
}

function handleCreateActionMitigasi_(body){
  setupMitigasiSheets();
  if(!body.judul || !String(body.judul).trim()) return {ok:false, error:'Judul action wajib diisi.'};
  if(!body.pic || !String(body.pic).trim()) return {ok:false, error:'PIC wajib ditentukan.'};
  const sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.SHEET_MITIGASI);
  const now=new Date().toISOString();
  const actionId='ACT-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
  sh.appendRow([
    actionId, body.pu||'', body.fungsi||'', body.kategori||'', body.bulan||'', body.tahun||'',
    String(body.judul).trim(), body.deskripsi||'', String(body.pic).trim(), 'Belum Mulai',
    body.targetSelesai||'', body.support||'', '', body.linkedRowKey||'',
    body.uid, now, now, body.uid
  ]);
  return {ok:true, actionId};
}

function handleUpdateActionMitigasi_(body){
  if(!body.actionId) return {ok:false, error:'actionId wajib diisi.'};
  const sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.SHEET_MITIGASI);
  if(!sh) return {ok:false, error:'Sheet mitigasi belum disiapkan.'};
  const data=sh.getDataRange().getValues();
  const header=data[0];
  const idCol=header.indexOf('ActionID'), picCol=header.indexOf('PIC'), statusCol=header.indexOf('Status');
  const supportCol=header.indexOf('Support'), targetCol=header.indexOf('TargetSelesai');
  const updCol=header.indexOf('TerakhirUpdate'), updOlehCol=header.indexOf('TerakhirUpdateOleh');
  for(let i=1;i<data.length;i++){
    if(String(data[i][idCol])!==String(body.actionId)) continue;
    const action={PIC:data[i][picCol]};
    if(!canEditActionMitigasi_(action, body.uid)) return {ok:false, error:'Cuma PIC action ini atau admin yang boleh update.'};
    const statusLama=data[i][statusCol];
    const row=i+1;
    if(body.status && ['Belum Mulai','Sedang Berjalan','Selesai'].indexOf(body.status)>=0){
      sh.getRange(row, statusCol+1).setValue(body.status);
    }
    if(body.support!=null) sh.getRange(row, supportCol+1).setValue(body.support);
    if(body.targetSelesai!=null) sh.getRange(row, targetCol+1).setValue(body.targetSelesai);
    sh.getRange(row, updCol+1).setValue(new Date().toISOString());
    sh.getRange(row, updOlehCol+1).setValue(body.uid);
    if(body.status && body.status!==statusLama){
      const logSh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.SHEET_MITIGASI_LOG);
      logSh.appendRow(['LOG-'+Date.now(), body.actionId, new Date().toISOString(), body.uid, statusLama, body.status, body.catatan||'']);
    }
    return {ok:true};
  }
  return {ok:false, error:'Action tidak ditemukan.'};
}

/* Simpan folder Drive evidence (dibuat sekali, dipakai ulang). */
function getOrCreateEvidenceFolder_(){
  const it=DriveApp.getFoldersByName(CFG.DRIVE_FOLDER_EVIDENCE);
  if(it.hasNext()) return it.next();
  return DriveApp.createFolder(CFG.DRIVE_FOLDER_EVIDENCE);
}

/* Tambah evidence ke action: dukung upload file base64 (disimpan ke Drive) ATAU
   langsung tempel URL (mis. sudah ada di Drive/WA/email). Bisa dua-duanya sekaligus. */
function handleAddEvidenceMitigasi_(body){
  if(!body.actionId) return {ok:false, error:'actionId wajib diisi.'};
  const sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.SHEET_MITIGASI);
  if(!sh) return {ok:false, error:'Sheet mitigasi belum disiapkan.'};
  const data=sh.getDataRange().getValues();
  const header=data[0];
  const idCol=header.indexOf('ActionID'), picCol=header.indexOf('PIC'), evCol=header.indexOf('EvidenceLinks');
  const updCol=header.indexOf('TerakhirUpdate'), updOlehCol=header.indexOf('TerakhirUpdateOleh');
  for(let i=1;i<data.length;i++){
    if(String(data[i][idCol])!==String(body.actionId)) continue;
    const action={PIC:data[i][picCol]};
    if(!canEditActionMitigasi_(action, body.uid)) return {ok:false, error:'Cuma PIC action ini atau admin yang boleh upload evidence.'};
    let url='';
    if(body.base64Data && body.fileName){
      const folder=getOrCreateEvidenceFolder_();
      const bytes=Utilities.base64Decode(body.base64Data);
      const blob=Utilities.newBlob(bytes, body.mimeType||'application/octet-stream', body.fileName);
      const file=folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      url=file.getUrl();
    }else if(body.url){
      url=String(body.url).trim();
    }else{
      return {ok:false, error:'Isi file (base64Data+fileName) atau url evidence.'};
    }
    const row=i+1;
    let existing=[];
    try{ existing=JSON.parse(data[i][evCol]||'[]'); }catch(e){ existing=[]; }
    existing.push({url, label:body.label||body.fileName||'', oleh:body.uid, waktu:new Date().toISOString()});
    sh.getRange(row, evCol+1).setValue(JSON.stringify(existing));
    sh.getRange(row, updCol+1).setValue(new Date().toISOString());
    sh.getRange(row, updOlehCol+1).setValue(body.uid);
    return {ok:true, url, evidence:existing};
  }
  return {ok:false, error:'Action tidak ditemukan.'};
}
