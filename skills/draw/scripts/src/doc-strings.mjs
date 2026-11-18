/**
 * Every word the description tables write themselves: headings, column headers and the names
 * of fixed values, per language. Labels come from the IR and are never translated. Key marks
 * (`PK`), visibilities and multiplicities are notation and stay as they are in every language.
 * The operators of a sequence block (`alt`, `else`, `loop`) are notation too, but the reader
 * of a table is not always one who knows it: the Condition column says what a block means in
 * words of the language (`block`), with the label of the block at `{label}`.
 *
 * A new language is one more entry with the same keys; a new diagram kind adds its name to
 * `diagram` and the words its tables need. The tests compare the keys of every language.
 */
export const DOC_STRINGS = {
  en: {
    bundleTitle: 'Diagram descriptions',
    diagramKind: 'Diagram kind',
    source: 'Source',
    omitted: 'Not shown on purpose',
    diagram: { flowchart: 'Flowchart', sequence: 'Sequence diagram', state: 'State diagram', er: 'ER diagram', class: 'Class diagram', architecture: 'Architecture diagram', activity: 'Activity diagram', usecase: 'Use case diagram' },
    heading: {
      actors: 'Actors', useCases: 'Use cases',
      participants: 'Participants', steps: 'Steps', notes: 'Notes', states: 'States', transitions: 'Transitions', entities: 'Entities', classes: 'Classes', relations: 'Relations',
      components: 'Components', stores: 'Data stores', queues: 'Queues', boundaries: 'Boundaries', connections: 'Connections', lanes: 'Lanes', groups: 'Groups',
    },
    column: {
      actor: 'Actor', useCase: 'Use case', role: 'Role',
      no: 'No.', kind: 'Kind', details: 'Details', participant: 'Participant', from: 'From', to: 'To', message: 'Message', condition: 'Condition', note: 'Note', position: 'Position', placedAfter: 'Placed after',
      state: 'State', parentState: 'Parent state', stateByEvent: 'State / Event', attribute: 'Attribute', type: 'Type', key: 'Key', comment: 'Comment', relation: 'Relation',
      fromCardinality: 'From cardinality', toCardinality: 'To cardinality', identifying: 'Identifying', fromAttribute: 'From attribute', toAttribute: 'To attribute',
      member: 'Member', visibility: 'Visibility', stereotype: 'Stereotype', label: 'Label', component: 'Component', store: 'Data store', queue: 'Queue', boundary: 'Boundary', inside: 'Inside', icon: 'Icon', frame: 'Frame',
      direction: 'Direction', lane: 'Lane', step: 'Step', next: 'Next', group: 'Group',
    },
    value: {
      actorKind: { person: 'Person', system: 'System' },
      actorRole: { primary: 'Primary', supporting: 'Supporting' },
      useCaseRelation: { association: 'Association', include: 'Include', extend: 'Extend', generalization: 'Generalization' },
      yes: 'Yes', no: 'No', noEvent: '(no event)', atStart: '(start)', noAttributes: '(no attributes)', noMembers: '(no members)', oneWay: 'One way', bothWays: 'Both ways', handOff: 'hand-off to {lane}',
      participant: { actor: 'Actor', participant: 'Participant', database: 'Database', boundary: 'Boundary', control: 'Control', entity: 'Entity' },
      message: { sync: 'Synchronous', async: 'Asynchronous', return: 'Reply' },
      position: { left: 'Left', right: 'Right', over: 'Over' },
      state: { initial: 'Initial', final: 'Final', simple: 'Simple', composite: 'Composite' },
      block: { alt: 'If {label}', else: 'Otherwise, if {label}', opt: 'Only if {label}', loop: 'Repeated: {label}', par: 'At the same time: {label}' },
      member: { attribute: 'Attribute', method: 'Method' },
      classRelation: { inheritance: 'Inheritance', realization: 'Realization', composition: 'Composition', aggregation: 'Aggregation', association: 'Association', dependency: 'Dependency' },
      component: { service: 'Service', database: 'Database', queue: 'Queue', cache: 'Cache', storage: 'Storage', client: 'Client', external: 'External system' },
      step: { action: 'Action', initial: 'Start', final: 'End', decision: 'Decision', merge: 'Merge', fork: 'Fork', join: 'Join' },
      shape: { process: 'Process', decision: 'Decision', terminal: 'Start / end', io: 'Input / output', subroutine: 'Subprocess', note: 'Note' },
    },
  },
  ja: {
    bundleTitle: '図の説明',
    diagramKind: '図の種類',
    source: 'ソース',
    omitted: '意図的に省略した内容',
    diagram: { flowchart: 'フローチャート', sequence: 'シーケンス図', state: '状態遷移図', er: 'ER図', class: 'クラス図', architecture: 'アーキテクチャ図', activity: 'アクティビティ図', usecase: 'ユースケース図' },
    heading: {
      actors: 'アクター', useCases: 'ユースケース',
      participants: '参加者', steps: 'ステップ', notes: 'ノート', states: '状態一覧', transitions: '状態遷移表', entities: 'エンティティ', classes: 'クラス', relations: '関連',
      components: 'コンポーネント', stores: 'データストア', queues: 'キュー', boundaries: '境界', connections: '接続', lanes: 'レーン', groups: 'グループ',
    },
    column: {
      actor: 'アクター', useCase: 'ユースケース', role: '役割',
      no: 'No.', kind: '種別', details: '詳細', participant: '参加者', from: '元', to: '先', message: 'メッセージ', condition: '条件', note: 'ノート', position: '位置', placedAfter: '配置位置（直後）',
      state: '状態', parentState: '親状態', stateByEvent: '状態 / イベント', attribute: '属性', type: '型', key: 'キー', comment: '備考', relation: '関連',
      fromCardinality: '元の多重度', toCardinality: '先の多重度', identifying: '依存関係', fromAttribute: '元の属性', toAttribute: '先の属性',
      member: 'メンバー', visibility: '可視性', stereotype: 'ステレオタイプ', label: 'ラベル', component: 'コンポーネント', store: 'データストア', queue: 'キュー', boundary: '境界', inside: '所属先', icon: 'アイコン', frame: '枠',
      direction: '方向', lane: 'レーン', step: 'ステップ', next: '次のステップ', group: 'グループ',
    },
    value: {
      actorKind: { person: '人', system: 'システム' },
      actorRole: { primary: '主アクター', supporting: '支援アクター' },
      useCaseRelation: { association: '関連', include: '包含', extend: '拡張', generalization: '汎化' },
      yes: 'はい', no: 'いいえ', noEvent: '（イベントなし）', atStart: '（先頭）', noAttributes: '（属性なし）', noMembers: '（メンバーなし）', oneWay: '単方向', bothWays: '双方向', handOff: '{lane} へ引き継ぎ',
      participant: { actor: 'アクター', participant: '参加者', database: 'データベース', boundary: 'バウンダリ', control: 'コントロール', entity: 'エンティティ' },
      message: { sync: '同期', async: '非同期', return: '応答' },
      position: { left: '左', right: '右', over: '上に重ねる' },
      state: { initial: '開始', final: '終了', simple: '通常', composite: '複合' },
      block: { alt: '{label} の場合', else: 'それ以外で {label} の場合', opt: '{label} の場合のみ', loop: '繰り返し: {label}', par: '同時に: {label}' },
      member: { attribute: '属性', method: 'メソッド' },
      classRelation: { inheritance: '継承', realization: '実現', composition: 'コンポジション', aggregation: '集約', association: '関連', dependency: '依存' },
      component: { service: 'サービス', database: 'データベース', queue: 'キュー', cache: 'キャッシュ', storage: 'ストレージ', client: 'クライアント', external: '外部システム' },
      step: { action: 'アクション', initial: '開始', final: '終了', decision: '分岐', merge: '合流', fork: '並行開始', join: '並行終了' },
      shape: { process: '処理', decision: '判断', terminal: '開始・終了', io: '入出力', subroutine: 'サブプロセス', note: 'ノート' },
    },
  },
  vi: {
    bundleTitle: 'Mô tả sơ đồ',
    diagramKind: 'Loại sơ đồ',
    source: 'Nguồn',
    omitted: 'Chủ ý không thể hiện',
    diagram: { flowchart: 'Lưu đồ', sequence: 'Sơ đồ trình tự', state: 'Sơ đồ trạng thái', er: 'Sơ đồ ER', class: 'Sơ đồ lớp', architecture: 'Sơ đồ kiến trúc', activity: 'Sơ đồ hoạt động', usecase: 'Sơ đồ use case' },
    heading: {
      actors: 'Tác nhân', useCases: 'Use case',
      participants: 'Thành phần tham gia', steps: 'Các bước', notes: 'Ghi chú', states: 'Trạng thái', transitions: 'Bảng chuyển trạng thái', entities: 'Thực thể', classes: 'Lớp', relations: 'Quan hệ',
      components: 'Thành phần', stores: 'Kho dữ liệu', queues: 'Hàng đợi', boundaries: 'Vùng', connections: 'Kết nối', lanes: 'Làn', groups: 'Nhóm',
    },
    column: {
      actor: 'Tác nhân', useCase: 'Use case', role: 'Vai trò',
      no: 'STT', kind: 'Loại', details: 'Chi tiết', participant: 'Thành phần tham gia', from: 'Từ', to: 'Đến', message: 'Thông điệp', condition: 'Điều kiện', note: 'Ghi chú', position: 'Vị trí', placedAfter: 'Đặt sau',
      state: 'Trạng thái', parentState: 'Trạng thái cha', stateByEvent: 'Trạng thái / Sự kiện', attribute: 'Thuộc tính', type: 'Kiểu', key: 'Khóa', comment: 'Ghi chú', relation: 'Quan hệ',
      fromCardinality: 'Bản số nguồn', toCardinality: 'Bản số đích', identifying: 'Quan hệ xác định', fromAttribute: 'Thuộc tính nguồn', toAttribute: 'Thuộc tính đích',
      member: 'Thành viên', visibility: 'Phạm vi truy cập', stereotype: 'Khuôn mẫu', label: 'Nhãn', component: 'Thành phần', store: 'Kho dữ liệu', queue: 'Hàng đợi', boundary: 'Vùng', inside: 'Nằm trong', icon: 'Biểu tượng', frame: 'Khung',
      direction: 'Chiều', lane: 'Làn', step: 'Bước', next: 'Bước tiếp theo', group: 'Nhóm',
    },
    value: {
      actorKind: { person: 'Người', system: 'Hệ thống' },
      actorRole: { primary: 'Chính', supporting: 'Hỗ trợ' },
      useCaseRelation: { association: 'Liên kết', include: 'Bao gồm', extend: 'Mở rộng', generalization: 'Tổng quát hóa' },
      yes: 'Có', no: 'Không', noEvent: '(không có sự kiện)', atStart: '(đầu sơ đồ)', noAttributes: '(không có thuộc tính)', noMembers: '(không có thành viên)', oneWay: 'Một chiều', bothWays: 'Hai chiều', handOff: 'chuyển giao cho {lane}',
      participant: { actor: 'Tác nhân', participant: 'Thành phần', database: 'Cơ sở dữ liệu', boundary: 'Biên', control: 'Điều khiển', entity: 'Thực thể' },
      message: { sync: 'Đồng bộ', async: 'Bất đồng bộ', return: 'Phản hồi' },
      position: { left: 'Bên trái', right: 'Bên phải', over: 'Đè lên' },
      state: { initial: 'Khởi đầu', final: 'Kết thúc', simple: 'Thông thường', composite: 'Phức hợp' },
      block: { alt: 'Nếu {label}', else: 'Ngược lại, nếu {label}', opt: 'Chỉ khi {label}', loop: 'Lặp lại: {label}', par: 'Đồng thời: {label}' },
      member: { attribute: 'Thuộc tính', method: 'Phương thức' },
      classRelation: { inheritance: 'Kế thừa', realization: 'Hiện thực hóa', composition: 'Hợp thành', aggregation: 'Kết tập', association: 'Liên kết', dependency: 'Phụ thuộc' },
      component: { service: 'Dịch vụ', database: 'Cơ sở dữ liệu', queue: 'Hàng đợi', cache: 'Bộ nhớ đệm', storage: 'Lưu trữ', client: 'Máy khách', external: 'Hệ thống bên ngoài' },
      step: { action: 'Hành động', initial: 'Bắt đầu', final: 'Kết thúc', decision: 'Rẽ nhánh', merge: 'Hợp nhánh', fork: 'Tách song song', join: 'Gộp song song' },
      shape: { process: 'Xử lý', decision: 'Quyết định', terminal: 'Bắt đầu / kết thúc', io: 'Vào / ra', subroutine: 'Quy trình con', note: 'Ghi chú' },
    },
  },
};

export const DOC_LANGS = Object.keys(DOC_STRINGS);
