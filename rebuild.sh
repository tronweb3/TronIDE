#!/bin/bash

rm -rf tron-packages
mkdir tron-packages

cd ../tron-solc-js
sh rebuild.sh

cd ../tron-remix
cp ../tron-solc-js/tron*.tgz ./tron-packages/.
rm ../tron-solc-js/tron*.tgz

cd ../tvm-js
sh rebuild.sh

cd ../tron-remix
cp ../tvm-js/packages/block/tvmjs*.tgz ./tron-packages/.
cp ../tvm-js/packages/blockchain/tvmjs*.tgz ./tron-packages/.
cp ../tvm-js/packages/common/tvmjs*.tgz ./tron-packages/.
cp ../tvm-js/packages/tx/tvmjs*.tgz ./tron-packages/.
cp ../tvm-js/packages/util/tvmjs*.tgz ./tron-packages/.
cp ../tvm-js/packages/vm/tvmjs*.tgz ./tron-packages/.

sh reinstall.sh
