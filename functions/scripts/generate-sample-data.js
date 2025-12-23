const fs = require('fs');
const path = require('path');

/**
 * ローカル開発用のサンプルデータ生成スクリプト
 * Graph Interactions と Users のサンプルJSONを生成
 */

// サンプル Graph Interactions データ
const sampleInteractions = [
  {
    id: 'interaction-001',
    appHost: 'Microsoft Teams',
    interactionType: 'chat',
    contexts: [
      {
        contextType: 'Chat',
        contextReference: 'chat-ref-001'
      }
    ],
    createdDateTime: new Date().toISOString(),
    locale: 'ja-JP',
    userId: 'user1@contoso.com',
    userPrincipalName: 'user1@contoso.com',
    conversationId: 'conv-001',
    messageId: 'msg-001',
    messageDateTime: new Date().toISOString(),
    messageRole: 'user',
    messageContent: 'プロジェクト進捗レポートを作成してください',
    responseDateTime: new Date(Date.now() + 5000).toISOString(),
    responseContent: 'プロジェクト進捗レポートのドラフトを作成しました。以下の項目を含めています：\n1. 現在の進捗状況\n2. マイルストーン達成度\n3. 課題とリスク',
    appVersion: '1.0.0'
  },
  {
    id: 'interaction-002',
    appHost: 'Microsoft Word',
    interactionType: 'document',
    contexts: [
      {
        contextType: 'Document',
        contextReference: 'doc-ref-001'
      }
    ],
    createdDateTime: new Date().toISOString(),
    locale: 'ja-JP',
    userId: 'user2@contoso.com',
    userPrincipalName: 'user2@contoso.com',
    conversationId: 'conv-002',
    messageId: 'msg-002',
    messageDateTime: new Date().toISOString(),
    messageRole: 'user',
    messageContent: '会議の議事録を要約してください',
    responseDateTime: new Date(Date.now() + 3000).toISOString(),
    responseContent: '会議の主要なポイント：\n- 予算承認: Q1予算が承認されました\n- アクションアイテム: 3つのタスクが割り当てられました\n- 次回会議: 来週木曜日10:00',
    appVersion: '1.0.0'
  },
  {
    id: 'interaction-003',
    appHost: 'Microsoft Excel',
    interactionType: 'spreadsheet',
    contexts: [
      {
        contextType: 'Spreadsheet',
        contextReference: 'sheet-ref-001'
      }
    ],
    createdDateTime: new Date().toISOString(),
    locale: 'ja-JP',
    userId: 'user3@contoso.com',
    userPrincipalName: 'user3@contoso.com',
    conversationId: 'conv-003',
    messageId: 'msg-003',
    messageDateTime: new Date().toISOString(),
    messageRole: 'user',
    messageContent: '売上データを分析して傾向を教えてください',
    responseDateTime: new Date(Date.now() + 7000).toISOString(),
    responseContent: '売上分析の結果：\n- 前四半期比: +15%の成長\n- トップ商品カテゴリ: デジタルサービス\n- 地域別: 東京エリアが最も好調',
    appVersion: '1.0.0'
  }
];

// サンプル Users データ
const sampleUsers = [
  {
    id: 'user-001',
    userPrincipalName: 'user1@contoso.com',
    displayName: '山田 太郎',
    mail: 'user1@contoso.com',
    department: '営業部',
    jobTitle: '営業マネージャー',
    assignedLicenses: [
      {
        skuId: 'copilot-sku-id-here'
      }
    ],
    onPremisesExtensionAttributes: {
      extensionAttribute10: '営業第一課'
    }
  },
  {
    id: 'user-002',
    userPrincipalName: 'user2@contoso.com',
    displayName: '佐藤 花子',
    mail: 'user2@contoso.com',
    department: 'マーケティング部',
    jobTitle: 'マーケティングスペシャリスト',
    assignedLicenses: [
      {
        skuId: 'copilot-sku-id-here'
      }
    ],
    onPremisesExtensionAttributes: {
      extensionAttribute10: 'デジタルマーケティンググループ'
    }
  },
  {
    id: 'user-003',
    userPrincipalName: 'user3@contoso.com',
    displayName: '鈴木 一郎',
    mail: 'user3@contoso.com',
    department: '経営企画部',
    jobTitle: 'データアナリスト',
    assignedLicenses: [
      {
        skuId: 'copilot-sku-id-here'
      }
    ],
    onPremisesExtensionAttributes: {
      extensionAttribute10: 'データ分析チーム'
    }
  }
];

// ディレクトリ作成
const sampleDataDir = path.join(__dirname, '../sample-data');
if (!fs.existsSync(sampleDataDir)) {
  fs.mkdirSync(sampleDataDir, { recursive: true });
}

// ファイル出力
fs.writeFileSync(
  path.join(sampleDataDir, 'graph_interactions.json'),
  JSON.stringify(sampleInteractions, null, 2)
);

fs.writeFileSync(
  path.join(sampleDataDir, 'users.json'),
  JSON.stringify(sampleUsers, null, 2)
);

console.log('✅ サンプルデータを生成しました:');
console.log(`  - ${path.join(sampleDataDir, 'graph_interactions.json')}`);
console.log(`  - ${path.join(sampleDataDir, 'users.json')}`);
console.log('\n次のステップ:');
console.log('1. Azurite を起動: azurite --location ./azurite-data');
console.log('2. Azure CLI でデータアップロード:');
console.log('   az storage blob upload --account-name devstoreaccount1 --container-name raw --name "graph_interactions/date=2025-01-01/sample.json" --file ./sample-data/graph_interactions.json --connection-string "UseDevelopmentStorage=true"');
