require('dotenv').config({ path: '../.env' });
const { connectDB } = require('../db');

async function findStatus() {
  const pool = await connectDB();
  
  // Try to find any table that might contain "Mới", "Đang xử lý", "Đã qualify", "Đã loại"
  const searchResults = await pool.request().query(`
    DECLARE @TableName NVARCHAR(256), @ColumnName NVARCHAR(256), @SQL NVARCHAR(MAX);
    
    IF OBJECT_ID('tempdb..#TempResults') IS NOT NULL
        DROP TABLE #TempResults;
        
    CREATE TABLE #TempResults (TableName NVARCHAR(256), ColumnName NVARCHAR(256));

    DECLARE col_cursor CURSOR FOR
    SELECT t.name AS TableName, c.name AS ColumnName
    FROM sys.tables t
    INNER JOIN sys.columns c ON t.object_id = c.object_id
    INNER JOIN sys.types ty ON c.system_type_id = ty.system_type_id AND c.user_type_id = ty.user_type_id
    WHERE ty.name IN ('varchar', 'nvarchar', 'char', 'nchar')

    OPEN col_cursor
    FETCH NEXT FROM col_cursor INTO @TableName, @ColumnName

    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @SQL = 'IF EXISTS (SELECT 1 FROM [' + @TableName + '] WHERE [' + @ColumnName + '] = N''Mới'' OR [' + @ColumnName + '] = N''Đang xử lý'') 
                    INSERT INTO #TempResults (TableName, ColumnName) VALUES (''' + @TableName + ''', ''' + @ColumnName + ''')'
        
        BEGIN TRY
            EXEC sp_executesql @SQL;
        END TRY
        BEGIN CATCH
            -- Ignore errors
        END CATCH
        
        FETCH NEXT FROM col_cursor INTO @TableName, @ColumnName
    END
    CLOSE col_cursor;
    DEALLOCATE col_cursor;

    SELECT * FROM #TempResults;
    DROP TABLE #TempResults;
  `);

  console.log("Tables containing 'Mới' or 'Đang xử lý':");
  console.log(searchResults.recordset);
  
  // Also list all taxonomy types
  const taxonomyRes = await pool.request().query(`
    SELECT DISTINCT TaxonomyType, TypeName = 
      (SELECT TOP 1 TieuDe FROM Taxonomy t2 WHERE t2.TaxonomyType = t.TaxonomyType) 
    FROM Taxonomy t
  `);
  console.log("\nTaxonomy Types:");
  console.log(taxonomyRes.recordset);

  process.exit(0);
}

findStatus().catch(console.error);
