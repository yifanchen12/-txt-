import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
function patch(file,fn){const p=path.join(root,file);if(fs.existsSync(p))fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));}
// Only the user's HTTP-only source is allowed; TLS checks remain enabled.
patch('android/app/src/main/AndroidManifest.xml',s=>s.includes('android:networkSecurityConfig')?s:s.replace('android:allowBackup="true"','android:allowBackup="true"\n        android:networkSecurityConfig="@xml/network_security_config"'));
const xml=path.join(root,'android/app/src/main/res/xml');if(fs.existsSync(xml))fs.writeFileSync(path.join(xml,'network_security_config.xml'),'<?xml version="1.0" encoding="utf-8"?><network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="true">kenshuzw.la</domain></domain-config></network-security-config>');
patch('ios/App/App/Info.plist', source => {
  let plist = source.replace(/\s*<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>armv7<\/string>\s*<\/array>/, '');
  const entries = [
    ['NSAppTransportSecurity', '<key>NSAppTransportSecurity</key><dict><key>NSExceptionDomains</key><dict><key>kenshuzw.la</key><dict><key>NSIncludesSubdomains</key><true/><key>NSExceptionAllowsInsecureHTTPLoads</key><true/></dict></dict></dict>'],
    ['UIFileSharingEnabled', '<key>UIFileSharingEnabled</key><true/>'],
    ['LSSupportsOpeningDocumentsInPlace', '<key>LSSupportsOpeningDocumentsInPlace</key><true/>'],
  ];
  for (const [key, xml] of entries) {
    if (plist.includes('<key>' + key + '</key>')) continue;
    const closing = /<\/dict>\s*<\/plist>\s*$/;
    if (!closing.test(plist)) throw new Error('Invalid iOS Info.plist root dictionary');
    plist = plist.replace(closing, '  ' + xml + '\n</dict>\n</plist>\n');
  }
  return plist;
});
const icon=path.join(root,'public/app-icon.png');
if(fs.existsSync(icon)){
 const ios=path.join(root,'ios/App/App/Assets.xcassets/AppIcon.appiconset');
 if(fs.existsSync(ios)){fs.copyFileSync(icon,path.join(ios,'AppIcon-512@2x.png'));fs.writeFileSync(path.join(ios,'Contents.json'),JSON.stringify({images:[{filename:'AppIcon-512@2x.png',idiom:'universal',platform:'ios',size:'1024x1024'}],info:{author:'xcode',version:1}},null,2));}
 for(const density of ['mdpi','hdpi','xhdpi','xxhdpi','xxxhdpi']){
  const directory=path.join(root,`android/app/src/main/res/mipmap-${density}`);
  if(fs.existsSync(directory))for(const name of ['ic_launcher.png','ic_launcher_round.png','ic_launcher_foreground.png'])fs.copyFileSync(icon,path.join(directory,name));
 }
}
console.log('Native projects configured; no signing secrets included.');
