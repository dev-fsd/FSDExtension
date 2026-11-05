IF EXISTS (SELECT 1 FROM sysobjects WHERE name = '%name' AND OBJECTPROPERTY(id, 'IsEncrypted') = 0) DROP %xtypename %name
