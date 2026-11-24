import sys,zipfile
src,dex,out=sys.argv[1:4]
zi=zipfile.ZipFile(src)
with zipfile.ZipFile(out,'w') as zo:
    def put(name,data,stored):
        info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0))
        info.compress_type=zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
        info.external_attr=0
        if stored:
            pos=zo.fp.tell()+30+len(name.encode())
            info.extra=b'\0'*((4-pos%4)%4)
        zo.writestr(info,data)
    for i in zi.infolist():
        put(i.filename,zi.read(i.filename),i.filename=='resources.arsc' or i.filename.endswith('.png'))
    put('classes.dex',open(dex,'rb').read(),True)
